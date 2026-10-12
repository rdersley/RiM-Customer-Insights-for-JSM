// Team performance: per agent (assignee) figures for tickets resolved in a
// period, and their open workload now. Worked out from Jira when a report runs;
// nothing is stored. Per-agent rows are only returned to Jira admins (index.js);
// everyone else gets the team totals.
import { slaState } from './sla.js';

export const SATISFACTION_FIELD = 'com.atlassian.servicedesk:sd-request-feedback';
const HOUR = 3600000;
const UNASSIGNED = { id: 'unassigned', name: 'Unassigned' };

const median = (values) => {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const round1 = (n) => (n === null ? null : Math.round(n * 10) / 10);

/** The satisfaction (CSAT) field's id from GET /rest/api/3/field, or null. */
export function satisfactionFieldId(fields) {
  return (Array.isArray(fields) ? fields : []).find((f) => String(f?.schema?.custom || '') === SATISFACTION_FIELD)?.id || null;
}

/** A 1–5 rating from a JSM satisfaction value, or null. */
export function ratingOf(value) {
  const n = Number(value?.rating ?? value);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
}

const agentOf = (issue) => {
  const a = issue?.fields?.assignee;
  return a?.accountId ? { id: String(a.accountId), name: String(a.displayName || 'Unknown') } : UNASSIGNED;
};

function emptyRow(agent) {
  return { agent, resolved: 0, hours: [], loggedSeconds: 0, ratings: [], sla: {}, types: {}, urgent: 0, open: 0, openAges: [], handlingMs: 0, handled: 0 };
}

// ---- Handling time (AHT) ---------------------------------------------------------

// JSM puts waiting statuses in the same "in progress" category as real work.
const WAITING = /wait|pending|hold|paused|awaiting|blocked/i;

/**
 * Whether a status counts as handling: the admin's list of status names when
 * set, otherwise "in progress" category statuses that aren't waiting ones.
 * `status` is { name, category } (category key from GET /rest/api/3/status).
 */
export function isHandlingStatus(status, handlingStatuses = []) {
  if (!status) return false;
  if (handlingStatuses.length) return handlingStatuses.some((n) => n.toLowerCase() === String(status.name).toLowerCase());
  return status.category === 'indeterminate' && !WAITING.test(String(status.name));
}

/** AHT for display: "under 1 min", "4 min", "1 h 20 min". */
export function minutesText(minutes) {
  if (minutes === null || minutes === undefined) return '–';
  if (minutes < 1) return 'under 1 min';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** A history's time in ms: an ISO date, or epoch seconds or milliseconds. */
export function changeTime(value) {
  if (typeof value === 'number' || /^\d+$/.test(String(value ?? ''))) {
    const n = Number(value);
    return n < 1e12 ? n * 1000 : n;
  }
  return Date.parse(value);
}

/**
 * Milliseconds each assignee had a ticket in a handling status, from its
 * status and assignee history (bulk changelog histories, any order). The
 * ticket's state before its first change comes from that change's "from";
 * with no changes, from its current status and assignee. Time runs from
 * creation to resolution (or `now`). Returns { accountId: ms }. Time in a
 * handling status with nobody assigned goes to whoever moved the ticket into
 * that status, else to "unassigned". `stats`, when given, collects the status
 * names seen and how many tickets had handling time (for the admin's check).
 */
export function handlingTimes(issue, histories, statusById, handlingStatuses = [], now = Date.now(), stats = null) {
  const f = issue.fields || {};
  const start = Date.parse(f.created);
  const end = Number.isFinite(Date.parse(f.resolutiondate)) ? Date.parse(f.resolutiondate) : now;
  if (!Number.isFinite(start) || end <= start) return {};
  // Duplicate histories (the bulk API can repeat them across pages) are counted once.
  const unique = [...new Map((histories || []).map((h, i) => [h.id ?? `i${i}`, h])).values()];
  const changes = unique
    .flatMap((h) => (h.items || []).map((item) => ({ at: changeTime(h.created), by: h.author?.accountId || null, field: item.fieldId || item.field, from: item.from, to: item.to })))
    .filter((c) => Number.isFinite(c.at) && (c.field === 'status' || c.field === 'assignee'))
    .sort((a, b) => a.at - b.at);
  const firstOf = (field) => changes.find((c) => c.field === field);
  let status = firstOf('status') ? firstOf('status').from : f.status?.id;
  let assignee = firstOf('assignee') ? firstOf('assignee').from : f.assignee?.accountId;
  let mover = null; // who moved the ticket into its current status
  const out = {};
  const seen = new Set();
  let at = start;
  const credit = (until) => {
    const from = Math.max(at, start);
    const to = Math.min(until, end);
    const s = statusById.get(String(status));
    if (s) seen.add(s.name);
    if (to > from && isHandlingStatus(s, handlingStatuses)) {
      const who = assignee || mover || 'unassigned';
      out[who] = (out[who] || 0) + (to - from);
    }
    at = Math.max(at, until);
  };
  for (const c of changes) {
    credit(c.at);
    if (c.field === 'status') { status = c.to; mover = c.by; } else assignee = c.to;
  }
  credit(end);
  if (stats) {
    for (const name of seen) stats.seen[name] = (stats.seen[name] || 0) + 1;
    if (Object.keys(out).length) stats.handled += 1;
    if (out.unassigned) stats.unassigned += 1;
  }
  return out;
}

/**
 * Per agent rows from resolved tickets (`resolved`) and open tickets
 * (`open`). `slaFields` [{ id, name }] and `satisfactionId` come from settings
 * and the site's fields; `urgent` is the set of priority names counted as
 * urgent (P1/P2 by default). `now` dates the open tickets' age.
 */
export function agentRows(resolved, open, { slaFields = [], satisfactionId = null, urgent = ['P1', 'P2', 'Highest', 'High', 'Critical'], now = Date.now(), handling = null, names = {} } = {}) {
  const rows = new Map();
  const row = (agent) => { if (!rows.has(agent.id)) rows.set(agent.id, emptyRow(agent)); return rows.get(agent.id); };
  const urgentSet = new Set(urgent.map((p) => p.toLowerCase()));
  for (const issue of resolved || []) {
    const r = row(agentOf(issue));
    const f = issue.fields || {};
    r.resolved += 1;
    const took = Date.parse(f.resolutiondate) - Date.parse(f.created);
    if (Number.isFinite(took) && took >= 0) r.hours.push(took / HOUR);
    if (Number(f.timespent) > 0) r.loggedSeconds += Number(f.timespent);
    const rating = satisfactionId ? ratingOf(f[satisfactionId]) : null;
    if (rating) r.ratings.push(rating);
    for (const s of slaFields) {
      const state = slaState(f[s.id]);
      if (!state) continue;
      r.sla[s.id] = r.sla[s.id] || { met: 0, breached: 0 };
      r.sla[s.id][state] += 1;
    }
    const type = f.issuetype?.name || f.requestType || 'Other';
    r.types[type] = (r.types[type] || 0) + 1;
    if (urgentSet.has(String(f.priority?.name || '').toLowerCase())) r.urgent += 1;
  }
  // Handling time per resolved ticket and assignee (`handling`: issue id -> { accountId: ms }).
  if (handling) {
    for (const issue of resolved || []) {
      for (const [accountId, ms] of Object.entries(handling[issue.id] || {})) {
        const r = row(accountId === 'team' ? { id: 'team', name: 'Team' } : accountId === 'unassigned' ? UNASSIGNED : { id: accountId, name: names[accountId] || rows.get(accountId)?.agent.name || 'Unknown' });
        r.handlingMs += ms;
        r.handled += 1;
      }
    }
  }
  for (const issue of open || []) {
    const r = row(agentOf(issue));
    r.open += 1;
    const age = (now - Date.parse(issue.fields?.created)) / (24 * HOUR);
    if (Number.isFinite(age)) r.openAges.push(age);
  }
  return [...rows.values()].map(summarise).sort((a, b) => b.resolved - a.resolved || b.open - a.open);
}

function summarise(r) {
  const typeList = Object.entries(r.types).sort((a, b) => b[1] - a[1]);
  return {
    agent: r.agent,
    resolved: r.resolved,
    medianHours: round1(median(r.hours)),
    loggedHours: round1(r.loggedSeconds / 3600),
    rating: r.ratings.length ? round1(r.ratings.reduce((a, b) => a + b, 0) / r.ratings.length) : null,
    rated: r.ratings.length,
    sla: Object.fromEntries(Object.entries(r.sla).map(([id, t]) => [id, { ...t, metShare: t.met + t.breached ? Math.round((t.met / (t.met + t.breached)) * 100) : null }])),
    urgentShare: r.resolved ? Math.round((r.urgent / r.resolved) * 100) : 0,
    topTypes: typeList.slice(0, 3).map(([name, count]) => ({ name, share: r.resolved ? Math.round((count / r.resolved) * 100) : 0 })),
    open: r.open,
    oldestOpenDays: r.openAges.length ? Math.round(Math.max(...r.openAges)) : null,
    // Average handling time: in-progress time per ticket the agent worked on.
    handlingHours: round1(r.handlingMs / HOUR),
    handled: r.handled,
    ahtHours: r.handled ? round1(r.handlingMs / HOUR / r.handled) : null,
    ahtMinutes: r.handled ? Math.round(r.handlingMs / 60000 / r.handled) : null,
  };
}

/** Team totals over agent rows (what everyone sees), from the same tickets. */
export function teamTotals(resolved, open, options = {}) {
  const asTeam = (issues) => (issues || []).map((i) => ({ ...i, fields: { ...i.fields, assignee: { accountId: 'team', displayName: 'Team' } } }));
  // Team handling: each ticket's handling time, whoever worked on it.
  const handling = options.handling
    ? Object.fromEntries(Object.entries(options.handling).map(([id, byAgent]) => [id, Object.values(byAgent).length ? { team: Object.values(byAgent).reduce((a, b) => a + b, 0) } : {}]))
    : null;
  const [total] = agentRows(asTeam(resolved), asTeam(open), { ...options, handling });
  const agents = new Set([...(resolved || []), ...(open || [])].map((i) => agentOf(i).id).filter((id) => id !== 'unassigned'));
  return { ...(total || summarise(emptyRow({ id: 'team', name: 'Team' }))), agents: agents.size };
}
