// Forge handlers for live portal reports and spike alerts.
// - scheduler: hourly trigger; queues the reports and alert checks that are due.
// - consumer: queue job (up to 15 minutes); refreshes or checks one organisation.
// Background jobs have no signed-in user, so Jira is read as the app. A
// portal report is built from `organizations = <that org>` only, so every
// ticket in it is one shared with that organisation, which its members can
// already open in the portal. The portal resolver (portal.js) checks the
// viewer belongs to the organisation on every request.
import { asApp, route } from '@forge/api';
import { readJson, runAnalysis, parseQuery } from './engine.js';
import { assignToApproved } from './ai.js';
import { assignByWords, isDue, liveCounts, livePeriod, refreshedSnapshotInput } from './live.js';
import { snapshotFrom } from './publish.js';
import { crewRates, headcountFor } from './headcount.js';
import * as storage from './storage.js';
import { checkOrganisation, isCheckDue } from './alerts.js';
import { isEmailDue, lastSlot } from './email.js';
import { isHealthDue } from './healthJobs.js';

const { deleteAlert, listAlerts, listLiveConfigs, loadAlertState, loadLiveConfig, loadLiveState, loadSettings, saveAlertState, saveReport, updateLiveState } = storage;
const ALERT_DAYS_KEPT = 30;

const QUEUE = 'live-report-refresh';
const queue = async () => new (await import('@forge/events')).Queue({ key: QUEUE });

/** Queues a refresh for one organisation; `reason` is logged. */
export async function queueRefresh(orgId, reason) {
  await (await queue()).push({ body: { orgId: String(orgId), reason } });
  await updateLiveState(orgId, { queuedAt: new Date().toISOString(), queuedFor: reason });
  console.log(`live: queued ${orgId} (${reason})`);
}

/**
 * The organisation as Jira has it now, by id. Searches use its name, so a
 * renamed organisation is followed, and another one later given the old name
 * is never picked up.
 */
async function currentOrganisation(orgId) {
  const response = await asApp().requestJira(route`/rest/servicedeskapi/organization/${String(orgId)}`, { headers: { Accept: 'application/json' } });
  if (response.status === 404) throw new Error('The organisation no longer exists.');
  const data = await readJson(response, 'Organization lookup');
  if (String(data.id) !== String(orgId) || !data.name) throw new Error('Organisation lookup returned a different organisation.');
  return { id: String(data.id), name: String(data.name) };
}

/** Portal request links for ticket keys: project key → service desk (portal) id. */
async function portalLinker() {
  try {
    const [info, desks] = await Promise.all([
      asApp().requestJira(route`/rest/api/3/serverInfo`, { headers: { Accept: 'application/json' } }).then((r) => readJson(r, 'Server info')),
      asApp().requestJira(route`/rest/servicedeskapi/servicedesk?limit=100`, { headers: { Accept: 'application/json' } }).then((r) => readJson(r, 'Service desks')),
    ]);
    const site = String(info.baseUrl || '').replace(/\/$/, '');
    const byProject = new Map((desks.values || []).map((d) => [String(d.projectKey), String(d.id)]));
    return (key) => {
      const desk = byProject.get(String(key).split('-')[0]);
      return site && desk ? `${site}/servicedesk/customer/portal/${desk}/${key}` : '';
    };
  } catch (error) {
    console.log(`live: portal links unavailable: ${error.message}`);
    return () => '';
  }
}

export async function refreshLiveReport(orgId) {
  const stored = await loadLiveConfig(orgId);
  if (!stored) return { skipped: 'no live report' };
  const startedAt = Date.now();
  try {
    const config = { ...stored, organization: await currentOrganisation(orgId) };
    const { from, to } = livePeriod(config);
    const query = parseQuery({ organization: config.organization, startDate: from, endDate: to, projects: config.projects, timeZone: config.timeZone });
    const { breakdowns, minPatternSize, placeholders, synonyms, headcounts, channelField } = await loadSettings();
    const report = await runAnalysis(query, { breakdowns, minPatternSize, placeholders, synonyms, channelField: channelField || null, mode: 'app', budgetMs: 240000 });
    let assignments;
    try {
      ({ assignments } = await assignToApproved(report, config.approved));
    } catch (error) {
      console.log(`live: AI assignment failed for ${orgId}, using word matching: ${error.message}`);
      assignments = assignByWords(report.groups, config.approved);
    }
    const counts = liveCounts(report, config.approved, assignments);
    const linkTo = await portalLinker();
    for (const pattern of counts.patterns) for (const example of pattern.examples || []) example.url = linkTo(example.key);
    // Tickets per 100 crew only when an admin ticked "Show on portal" for this organisation.
    const shared = headcountFor(headcounts, [orgId]);
    const headcount = shared?.portal ? shared : null;
    const crew = headcount ? crewRates(report, headcount) : null;
    const snapshot = snapshotFrom(refreshedSnapshotInput(config, report, counts, new Date(), { breakdowns, crewRates: crew }), { detailed: true });
    // Don't overwrite if the agent removed or replaced the live report meanwhile.
    const current = await loadLiveConfig(orgId);
    if (!current || current.publishedAt !== config.publishedAt) return { skipped: 'changed while refreshing' };
    await saveReport(snapshot);
    await updateLiveState(orgId, { lastRefreshAt: snapshot.refreshedAt, lastError: null, queuedAt: null });
    console.log(`live: refreshed ${orgId} in ${Date.now() - startedAt}ms, ${counts.unreviewed.length} unreviewed`);
    return { refreshed: true };
  } catch (error) {
    await updateLiveState(orgId, { lastError: String(error.message || error).slice(0, 300), lastErrorAt: new Date().toISOString(), queuedAt: null });
    console.error(`live: refresh failed for ${orgId}: ${error.message}`);
    return { failed: true };
  }
}

export const scheduler = async () => {
  const configs = await listLiveConfigs();
  let queued = 0;
  for (const config of configs) {
    const state = await loadLiveState(config.organization.id);
    if (isDue(config, state)) { await queueRefresh(config.organization.id, 'schedule'); queued += 1; }
  }
  console.log(`live: scheduler checked ${configs.length}, queued ${queued}`);
  await scheduleAlerts();
  await scheduleEmails();
  await scheduleHealth();
  const cleaned = await storage.scrubAccountIds();
  if (cleaned) console.log(`privacy: removed account ids from ${cleaned} stored items`);
};

/** Queues a spike check for one organisation (the scheduler, or "Check now"). */
export async function queueAlertCheck(orgId, state = null) {
  await (await queue()).push({ body: { type: 'alerts', orgId: String(orgId) } });
  await saveAlertState(orgId, { ...(state || await loadAlertState(orgId)), queuedAt: new Date().toISOString() });
}

/** Queues the daily spike check for watched organisations, and drops old alerts. */
async function scheduleAlerts() {
  const { alerts } = await loadSettings();
  let queued = 0;
  if (alerts?.enabled) {
    for (const organization of alerts.organizations) {
      const state = await loadAlertState(organization.id);
      const recentlyQueued = state.queuedAt && Date.now() - Date.parse(state.queuedAt) < 3600000;
      if (!isCheckDue(state) || recentlyQueued) continue;
      await queueAlertCheck(organization.id, state);
      queued += 1;
    }
  }
  const cutoff = Date.now() - ALERT_DAYS_KEPT * 86400000;
  const old = (await listAlerts()).filter((a) => Date.parse(a.createdAt) < cutoff);
  for (const alert of old) await deleteAlert(alert.id);
  console.log(`alerts: scheduler queued ${queued}, removed ${old.length} old`);
}

/** Queues an email report (the scheduler, "Send now" or a test). */
export async function queueEmail(scheduleId, { reason = 'schedule', slot = null, overrideTo = null } = {}) {
  await (await queue()).push({ body: { type: 'email', scheduleId: String(scheduleId), reason, slot, overrideTo } });
  await storage.updateScheduleState(scheduleId, { queuedAt: new Date().toISOString(), queuedSlot: slot });
}

/** Queues email schedules whose latest slot hasn't been sent. */
async function scheduleEmails() {
  const schedules = await storage.loadSchedules();
  let queued = 0;
  const now = new Date();
  for (const schedule of schedules) {
    const state = await storage.loadScheduleState(schedule.id);
    if (!isEmailDue(schedule, state, now)) continue;
    await queueEmail(schedule.id, { slot: lastSlot(schedule, now) });
    queued += 1;
  }
  if (schedules.length) console.log(`email: scheduler checked ${schedules.length}, queued ${queued}`);
}

/** Queues one organisation's health score (the scheduler, or "Refresh now"). */
export async function queueHealth(orgId) {
  await (await queue()).push({ body: { type: 'health', orgId: String(orgId) } });
  const record = await storage.loadHealth(orgId);
  if (record) await storage.saveHealth({ ...record, queuedAt: new Date().toISOString() });
}

/** Queues today's health scores for the organisations on the list, and drops records for ones taken off it. */
async function scheduleHealth() {
  const { health } = await loadSettings();
  const listed = new Set((health?.organizations || []).map((o) => o.id));
  const records = await storage.listHealth();
  for (const r of records) if (!listed.has(String(r.organization?.id))) await storage.deleteHealth(r.organization.id);
  if (!health?.enabled) return;
  const byOrg = new Map(records.map((r) => [String(r.organization?.id), r]));
  let queued = 0;
  for (const organization of health.organizations) {
    if (!isHealthDue(byOrg.get(organization.id))) continue;
    await (await queue()).push({ body: { type: 'health', orgId: organization.id } });
    await storage.saveHealth({ history: [], ...byOrg.get(organization.id), organization, queuedAt: new Date().toISOString() });
    queued += 1;
  }
  if (queued) console.log(`health: scheduler queued ${queued} of ${health.organizations.length}`);
}

export const consumer = async (event) => {
  if (event?.body?.type === 'email') {
    const { sendSchedule } = await import('./emailJobs.js');
    await sendSchedule(event.body.scheduleId, { reason: event.body.reason, slot: event.body.slot, overrideTo: event.body.overrideTo });
    return;
  }
  const orgId = event?.body?.orgId;
  if (!/^\d{1,18}$/.test(String(orgId))) return;
  if (event?.body?.type === 'health') {
    const { checkHealth } = await import('./healthJobs.js');
    await checkHealth(orgId);
    return;
  }
  if (event?.body?.type === 'alerts') await checkOrganisation(orgId, storage);
  else await refreshLiveReport(orgId);
};
