// The all-customers health list: once a day, each organisation an admin chose
// (settings → Customers → Customer health) is analysed as the app over the
// last 30 days and its score stored with a 90-day history. Queued by the hourly
// scheduler (liveJobs.js); one organisation per queue event.
import { backlogFor, parseQuery, runAnalysis, satisfactionField } from './engine.js';
import { analysisConfig } from './settings.js';
import { addHistory, healthOf } from './health.js';
import * as storage from './storage.js';

export const HEALTH_DAYS = 30;
const RUN_FROM_HOUR = 5; // UTC: after the night's tickets, before the working day
const REQUEUE_MS = 2 * 3600000;

const day = (date) => date.toISOString().slice(0, 10);

/** The last HEALTH_DAYS full days before `now`. */
export function healthPeriod(now = new Date()) {
  const end = new Date(Date.parse(`${day(now)}T00:00:00Z`) - 86400000);
  const start = new Date(end.getTime() - (HEALTH_DAYS - 1) * 86400000);
  return { from: day(start), to: day(end) };
}

/** Whether an organisation's score is due: not yet worked out today, after RUN_FROM_HOUR, and not just queued. */
export function isHealthDue(record, now = new Date()) {
  if (record?.date === day(now)) return false;
  if (now.getUTCHours() < RUN_FROM_HOUR) return false;
  return !(record?.queuedAt && now.getTime() - Date.parse(record.queuedAt) < REQUEUE_MS);
}

/** Works out and stores one organisation's score. */
export async function checkHealth(orgId, { now = new Date() } = {}) {
  const settings = await storage.loadSettings();
  const organization = (settings.health?.organizations || []).find((o) => o.id === String(orgId));
  if (!settings.health?.enabled || !organization) return { skipped: 'not on the health list' };
  const previous = await storage.loadHealth(orgId);
  const startedAt = Date.now();
  try {
    const { from, to } = healthPeriod(now);
    const payload = { organization, startDate: from, endDate: to };
    const config = analysisConfig(settings, payload);
    const query = parseQuery(payload);
    const [satisfactionId, backlog] = await Promise.all([satisfactionField('app'), backlogFor(query, 'app')]);
    const report = await runAnalysis(query, {
      breakdowns: settings.breakdowns || [], ...config.patterns, slaFields: config.slaFields, devices: settings.devices, channelField: null,
      satisfactionId, mode: 'app', budgetMs: 240000,
    });
    const health = healthOf(report, backlog);
    const record = {
      organization,
      date: day(now),
      updatedAt: now.toISOString(),
      period: { from, to },
      tickets: report.currentCount,
      previousTickets: report.previousCount,
      score: health.score,
      band: health.band?.label || null,
      kind: health.band?.kind || null,
      weakest: health.weakest,
      signals: health.signals.map(({ key, label, score, detail, share }) => ({ key, label, score, detail, share })),
      history: addHistory(previous?.history, day(now), health.score),
      lastError: null,
      queuedAt: null,
    };
    await storage.saveHealth(record);
    console.log(`health: ${orgId} scored ${health.score ?? 'n/a'} from ${health.signals.length} signals, ${report.currentCount} tickets, ${Date.now() - startedAt}ms`);
    return { scored: health.score };
  } catch (error) {
    const message = String(error.message || error).slice(0, 300);
    await storage.saveHealth({ ...(previous || { organization, history: [] }), organization, lastError: message, lastErrorAt: now.toISOString(), queuedAt: null });
    console.error(`health: ${orgId} failed: ${message}`);
    return { failed: true };
  }
}
