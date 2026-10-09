// Portal reports: an agent approves the issue list and summary once; the app
// builds what customers see from its own analysis of that organisation's
// tickets (never from the agent's page), then refreshes the numbers on a
// schedule or when a customer asks. Schedule 'off' is built once, for the
// period the agent published.
// Pure logic here; the Forge handlers are in liveJobs.js.
import { median, patternTrend } from './analysis.js';
import { presetRange, PRESETS } from './dates.js';
import { validTimeZone } from './timeOfDay.js';
import { LIVE_SCHEDULES } from './publish.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EXAMPLES = 5;

const HOUR = 3600000;
const INTERVAL = { daily: 23 * HOUR, weekly: 7 * 24 * HOUR - HOUR };
const QUEUED_WINDOW = 30 * 60000; // don't queue the same report twice within this
export const CUSTOMER_REFRESH_EVERY = HOUR;
const MAX_APPROVED = 15;
const UNREVIEWED_MIN = 3;

const clip = (value, length) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, length);

/**
 * Report settings from the agent's publish, bounded. Schedule 'off' keeps the
 * published period (`input.period`); otherwise the period rolls with `preset`.
 */
export function liveConfigFrom(input, { organization, projects = [], now = new Date() }) {
  const schedule = LIVE_SCHEDULES.includes(input?.schedule) ? input.schedule : 'off';
  const preset = PRESETS.some((p) => p.key === input?.preset) ? input.preset : 'last-30';
  const from = String(input?.period?.from ?? '');
  const to = String(input?.period?.to ?? '');
  if (schedule === 'off' && !(ISO_DATE.test(from) && ISO_DATE.test(to) && from <= to)) throw new Error('Invalid period.');
  return {
    organization: { id: String(organization.id), name: clip(organization.name, 120) },
    projects: (Array.isArray(projects) ? projects : []).map((p) => clip(p, 50)).filter(Boolean).slice(0, 10),
    preset,
    schedule,
    ...(schedule === 'off' ? { period: { from, to } } : {}),
    // The publishing agent's time zone: refreshes show customers when requests arrive in it.
    timeZone: validTimeZone(input?.timeZone),
    approved: (Array.isArray(input?.approved) ? input.approved : [])
      .map((a) => ({ title: clip(a?.title, 80), summary: clip(a?.summary, 300) }))
      .filter((a) => a.title)
      .slice(0, MAX_APPROVED),
    overview: clip(input?.overview, 1500),
    actions: (Array.isArray(input?.actions) ? input.actions : []).map((a) => clip(a, 240)).filter(Boolean).slice(0, 5),
    summaryWrittenAt: now.toISOString(),
    publishedAt: now.toISOString(),
  };
}

/** The rolling period for a refresh, e.g. the last 30 days up to today. */
export function livePeriod(config, now = new Date()) {
  if (config.schedule === 'off' && config.period) return config.period;
  return presetRange(config.preset, now) || presetRange('last-30', now);
}

export const isLive = (config) => Boolean(config && LIVE_SCHEDULES.includes(config.schedule));

export function isDue(config, state, now = Date.now()) {
  if (!config || !LIVE_SCHEDULES.includes(config.schedule)) return false;
  if (state?.queuedAt && now - Date.parse(state.queuedAt) < QUEUED_WINDOW) return false;
  const last = state?.lastRefreshAt ? Date.parse(state.lastRefreshAt) : 0;
  return now - last >= INTERVAL[config.schedule];
}

/** When a customer may next ask for a refresh (ms), or 0 if now. */
export function nextCustomerRefresh(state, now = Date.now()) {
  const last = Math.max(state?.requestedAt ? Date.parse(state.requestedAt) : 0, state?.queuedAt ? Date.parse(state.queuedAt) : 0);
  const next = last + CUSTOMER_REFRESH_EVERY;
  return next > now ? next : 0;
}

/**
 * Counts per approved issue from a fresh report. `assignments[i]` is the
 * approved index for report.groups[i], or -1. "Other requests" is the exact
 * remainder, so the numbers always add up to the period total.
 */
export function liveCounts(report, approved, assignments) {
  const sums = approved.map(() => ({ count: 0, previousCount: 0, groups: [] }));
  const unassigned = [];
  (report.groups || []).forEach((group, i) => {
    const target = assignments[i] ?? -1;
    if (target >= 0 && target < approved.length) {
      sums[target].count += group.count;
      sums[target].previousCount += group.previousCount;
      sums[target].groups.push(group);
    } else unassigned.push(group);
  });
  const estimated = Boolean(report.sampled);
  const patterns = approved.map((a, i) => ({ ...a, count: sums[i].count, previousCount: sums[i].previousCount, estimated, ...detailsOf(sums[i].groups, report) }));
  const assignedNow = sums.reduce((s, x) => s + x.count, 0);
  const assignedBefore = sums.reduce((s, x) => s + x.previousCount, 0);
  const other = { title: 'Other requests', summary: 'Requests that don’t fit the issues above.', count: Math.max(0, report.currentCount - assignedNow), previousCount: Math.max(0, report.previousCount - assignedBefore), estimated };
  return {
    patterns: other.count > 0 ? [...patterns, other] : patterns,
    unreviewed: unassigned.filter((g) => g.count >= UNREVIEWED_MIN).sort((a, b) => b.count - a.count).slice(0, 5).map((g) => ({ title: g.theme, count: g.count })),
  };
}

/**
 * What customers see for one approved issue, from the report groups assigned
 * to it: trend, resolution time and the newest example tickets. Every ticket
 * comes from the organisation's own search (organizations = that org).
 */
function detailsOf(groups, report) {
  if (!groups.length) return { trend: null, medianHours: null, openShare: null, examples: [], hours: null };
  const buckets = groups.every((g) => Array.isArray(g.buckets))
    ? groups.reduce((sum, g) => sum.map((n, i) => n + (g.buckets[i] || 0)), new Array(groups[0].buckets.length).fill(0))
    : null;
  const analysed = groups.reduce((s, g) => s + (g.sampleCount || g.count || 0), 0);
  const open = groups.reduce((s, g) => s + (g.openCount || 0), 0);
  return {
    trend: buckets ? patternTrend({ buckets }, report) : null,
    medianHours: median(groups.flatMap((g) => g.resolvedHours || [])),
    openShare: analysed ? Math.round((open / analysed) * 100) : null,
    hours: groups.every((g) => Array.isArray(g.hours)) ? groups.reduce((sum, g) => sum.map((n, i) => n + (g.hours[i] || 0)), new Array(24).fill(0)) : null,
    examples: groups.flatMap((g) => g.tickets || [])
      .sort((a, b) => Date.parse(b.created) - Date.parse(a.created))
      .slice(0, EXAMPLES)
      .map(({ key, summary, status, created }) => ({ key, summary, status, created })),
  };
}

/** Breakdowns an admin marked "Show on portal", by field id. */
export function portalBreakdowns(report, breakdowns = []) {
  const shown = new Set(breakdowns.filter((b) => b.portal).map((b) => b.id));
  return (report.breakdowns || []).filter((b) => shown.has(b.id));
}

/** Input for snapshotFrom() after a refresh: fresh numbers, the agent's words. */
export function refreshedSnapshotInput(config, report, counts, now = new Date(), options = {}) {
  return {
    organization: config.organization,
    period: { from: report.startDate, to: report.endDate },
    totals: { current: report.currentCount, previous: report.previousCount },
    timeSeries: report.timeSeries,
    patterns: counts.patterns,
    overview: config.overview,
    actions: config.actions,
    publishedAt: config.publishedAt,
    summaryWrittenAt: config.summaryWrittenAt,
    refreshedAt: now.toISOString(),
    live: isLive(config) ? { preset: config.preset, schedule: config.schedule } : null,
    unreviewed: counts.unreviewed,
    resolution: report.resolution || null,
    timeOfDay: report.timeOfDay ? { timeZone: report.timeOfDay.timeZone, grid: report.timeOfDay.grid, estimated: report.timeOfDay.estimated } : null,
    breakdowns: portalBreakdowns(report, options.breakdowns),
    crewRates: options.crewRates || null,
  };
}

/** Fallback when the AI is unavailable: match a group to an approved title by shared words. */
export function assignByWords(groups, approved) {
  const words = (s) => new Set(String(s).toLowerCase().match(/[a-z0-9]{3,}/g) || []);
  const targets = approved.map((a) => words(a.title));
  return groups.map((g) => {
    const w = words(g.theme);
    let best = -1;
    let bestScore = 0.5;
    targets.forEach((t, i) => {
      const shared = [...w].filter((x) => t.has(x)).length;
      const score = shared / Math.max(1, Math.min(w.size, t.size));
      if (score >= bestScore) { best = i; bestScore = score; }
    });
    return best;
  });
}
