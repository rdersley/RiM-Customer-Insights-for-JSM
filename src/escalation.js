// Escalation levels (internal reports with project settings that switch it on,
// e.g. SD): the highest support level each ticket reached, from its status
// history, and how long it took from creation to reach 2nd and 3rd level.
import { changeTime } from './agents.js';

export const LEVELS = 3;
const DEFAULT_PATTERNS = [/\b(1st|first)\b|level\s*1\b|\bl1\b|1st line/i, /\b(2nd|second)\b|level\s*2\b|\bl2\b|2nd line/i, /\b(3rd|third)\b|level\s*3\b|\bl3\b|3rd line/i];
const HOUR = 3600000;
const clip = (value, length) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, length);

/** Escalation settings for project settings: { enabled, levels: [[status names] x3] }. */
export function sanitizeEscalation(input) {
  const levels = Array.from({ length: LEVELS }, (_, i) => {
    const raw = input?.levels?.[i];
    return [...new Set((Array.isArray(raw) ? raw : String(raw ?? '').split(/[\n,]/)).map((n) => clip(n, 60)).filter(Boolean))].slice(0, 20);
  });
  return { enabled: input?.enabled === true, levels };
}

/** The level (1–3) a status name means, or 0: the admin's lists, else the name. */
export function levelOf(name, levels = []) {
  const lower = String(name || '').toLowerCase();
  const listed = levels.findIndex((list) => (list || []).some((n) => n.toLowerCase() === lower));
  if (listed >= 0) return listed + 1;
  if (levels.some((list) => list?.length)) return 0; // lists set: only listed statuses count
  const auto = DEFAULT_PATTERNS.findIndex((re) => re.test(String(name || '')));
  return auto >= 0 ? auto + 1 : 0;
}

/**
 * The highest level a ticket reached and when it first reached each level
 * (ms after creation), from its status history (any order, epoch or ISO times).
 */
export function escalationOf(issue, histories, statusById, levels = []) {
  const created = Date.parse(issue?.fields?.created);
  const changes = (histories || [])
    .flatMap((h) => (h.items || []).map((item) => ({ at: changeTime(h.created), field: item.fieldId || item.field, from: item.from, to: item.to })))
    .filter((c) => c.field === 'status' && Number.isFinite(c.at))
    .sort((a, b) => a.at - b.at);
  const nameOf = (id) => statusById.get(String(id))?.name || '';
  const first = changes.length ? changes[0].from : issue?.fields?.status?.id;
  const reached = {};
  const note = (statusId, at) => {
    const level = levelOf(nameOf(statusId), levels);
    if (level && reached[level] === undefined) reached[level] = Math.max(0, at - created);
  };
  note(first, created);
  for (const c of changes) note(c.to, c.at);
  const highest = Math.max(0, ...Object.keys(reached).map(Number));
  return { highest, reached };
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : null;
};
const hours = (ms) => (ms === null ? null : Math.round((ms / HOUR) * 10) / 10);

/**
 * Totals over tickets' escalations: per highest level reached (0 = no level
 * status), the share, and time to reach each level 2..3 (median, average, 90th).
 */
export function escalationSummary(results) {
  const total = results.length;
  const byLevel = Array.from({ length: LEVELS + 1 }, (_, level) => {
    const tickets = results.filter((r) => r.highest === level).length;
    return { level, tickets, share: total ? Math.round((tickets / total) * 1000) / 10 : 0 };
  });
  const reach = Array.from({ length: LEVELS }, (_, i) => i + 1).map((level) => {
    const times = results.map((r) => r.reached[level]).filter((ms) => ms !== undefined);
    return {
      level,
      tickets: times.length,
      share: total ? Math.round((times.length / total) * 1000) / 10 : 0,
      medianHours: hours(median(times)),
      averageHours: hours(times.length ? times.reduce((a, b) => a + b, 0) / times.length : null),
      p90Hours: hours(percentile(times, 90)),
    };
  });
  return { total, byLevel, reach };
}
