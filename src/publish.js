// Reports published to the customer portal. An agent reviews a report and
// publishes a snapshot for one organisation; members of that organisation see
// it from the portal user menu.
// What an agent's page submits is themes and counts only. Ticket examples,
// trends and breakdowns (`detailed`) are only taken from the app's own
// analysis of that organisation (liveJobs.js), never from a page.

import { validTimeZone } from './timeOfDay.js';

export const MAX_PATTERNS = 15;
const MAX_POINTS = 60;
const ORG_ID = /^\d{1,18}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
export const LIVE_SCHEDULES = ['daily', 'weekly'];

const clip = (value, length) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, length);
const count = (value) => (Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value))) : 0);

export function reportKey(orgId) {
  if (!ORG_ID.test(String(orgId))) throw new Error('Invalid organisation.');
  return `published-report:${orgId}`;
}

const MAX_EXAMPLES = 5;
const MAX_BREAKDOWNS = 5;
const MAX_VALUES = 10;
const ISSUE_KEY = /^[A-Z][A-Z0-9_]{0,49}-\d{1,10}$/;
const hours = (value) => (Number.isFinite(Number(value)) && value !== null ? Math.max(0, Math.round(Number(value) * 10) / 10) : null);
const share = (value) => (Number.isFinite(Number(value)) && value !== null ? Math.min(100, Math.max(0, Math.round(Number(value)))) : null);
const portalUrl = (value) => (/^https:\/\/[^\s"<>]+\/servicedesk\/customer\/portal\/\d+\/[A-Z][A-Z0-9_]*-\d+$/.test(String(value)) ? String(value) : '');

const hourCounts = (value) => (Array.isArray(value) && value.length === 24 ? value.map(count) : null);
const timeOfDayOf = (value) => (Array.isArray(value?.grid) && value.grid.length === 7 && value.grid.every((row) => Array.isArray(row) && row.length === 24)
  ? { timeZone: validTimeZone(value.timeZone), grid: value.grid.map((row) => row.map(count)), estimated: Boolean(value.estimated) }
  : null);

function patternDetails(p) {
  return {
    hours: hourCounts(p?.hours),
    trend: Array.isArray(p?.trend)
      ? p.trend.filter((t) => ISO_DATE.test(String(t?.date))).slice(0, MAX_POINTS).map((t) => ({ date: String(t.date), count: count(t.count), days: Math.max(1, count(t.days) || 1) }))
      : null,
    medianHours: hours(p?.medianHours),
    openShare: share(p?.openShare),
    examples: (Array.isArray(p?.examples) ? p.examples : [])
      .filter((e) => ISSUE_KEY.test(String(e?.key)))
      .slice(0, MAX_EXAMPLES)
      .map((e) => ({ key: String(e.key), summary: clip(e.summary, 200), status: clip(e.status, 40), created: Number.isFinite(Date.parse(e?.created)) ? new Date(Date.parse(e.created)).toISOString() : null, url: portalUrl(e.url) })),
  };
}

function breakdownsOf(input) {
  return (Array.isArray(input) ? input : []).slice(0, MAX_BREAKDOWNS).map((b) => ({
    label: clip(b?.label, 40),
    estimated: Boolean(b?.estimated),
    values: (Array.isArray(b?.values) ? b.values : []).slice(0, MAX_VALUES).map((v) => ({
      value: clip(v?.value, 80), count: count(v?.count), previousCount: count(v?.previousCount), medianHours: hours(v?.medianHours),
    })).filter((v) => v.value),
  })).filter((b) => b.label && b.values.length);
}

/**
 * Validates and bounds a snapshot. Anything not listed is dropped. `detailed`
 * keeps ticket examples, trends, resolution and breakdowns; only the app's own
 * analysis passes it.
 */
export function snapshotFrom(input, { now = new Date(), detailed = false } = {}) {
  const orgId = String(input?.organization?.id ?? '');
  reportKey(orgId);
  const from = String(input?.period?.from ?? '');
  const to = String(input?.period?.to ?? '');
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) throw new Error('Invalid period.');
  const patterns = (Array.isArray(input?.patterns) ? input.patterns : [])
    .map((p) => ({
      title: clip(p?.title, 80),
      summary: clip(p?.summary, 300),
      count: count(p?.count),
      previousCount: count(p?.previousCount),
      estimated: Boolean(p?.estimated),
      ...(detailed ? patternDetails(p) : {}),
    }))
    .filter((p) => p.title)
    .slice(0, MAX_PATTERNS);
  const details = detailed ? {
    detailed: true,
    resolution: input?.resolution ? { medianHours: hours(input.resolution.medianHours), openShare: share(input.resolution.openShare) } : null,
    breakdowns: breakdownsOf(input?.breakdowns),
    timeOfDay: timeOfDayOf(input?.timeOfDay),
  } : {};
  const current = count(input?.totals?.current);
  const previous = count(input?.totals?.previous);
  return {
    organization: { id: orgId, name: clip(input?.organization?.name, 120) },
    period: { from, to },
    totals: { current, previous, changePercent: previous ? Math.round(((current - previous) / previous) * 100) : null },
    timeSeries: (Array.isArray(input?.timeSeries) ? input.timeSeries : [])
      .filter((p) => ISO_DATE.test(String(p?.date)))
      .slice(0, MAX_POINTS)
      .map((p) => ({ date: String(p.date), count: count(p.count) })),
    patterns,
    overview: clip(input?.overview, 1500),
    actions: (Array.isArray(input?.actions) ? input.actions : []).map((a) => clip(a, 240)).filter(Boolean).slice(0, 5),
    publishedAt: ISO_TIME.test(String(input?.publishedAt)) ? String(input.publishedAt) : now.toISOString(),
    // Live reports: the agent's summary keeps its date; numbers refresh.
    summaryWrittenAt: ISO_TIME.test(String(input?.summaryWrittenAt)) ? String(input.summaryWrittenAt) : now.toISOString(),
    refreshedAt: ISO_TIME.test(String(input?.refreshedAt)) ? String(input.refreshedAt) : now.toISOString(),
    live: input?.live && LIVE_SCHEDULES.includes(input.live.schedule) ? { preset: clip(input.live.preset, 30), schedule: input.live.schedule } : null,
    // Agent-only: patterns that fit no approved issue yet.
    unreviewed: (Array.isArray(input?.unreviewed) ? input.unreviewed : []).slice(0, 10)
      .map((u) => ({ title: clip(u?.title, 80), count: count(u?.count) })).filter((u) => u.title),
    ...details,
  };
}

/** What a customer sees: no unreviewed agent notes (or a publisher's account id, kept by older versions). */
export function portalView(snapshot) {
  if (!snapshot) return null;
  const { publishedBy, unreviewed, ...visible } = snapshot;
  return visible;
}
