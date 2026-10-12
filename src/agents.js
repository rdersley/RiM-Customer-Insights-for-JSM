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
  return { agent, resolved: 0, hours: [], loggedSeconds: 0, ratings: [], sla: {}, types: {}, urgent: 0, open: 0, openAges: [] };
}

/**
 * Per agent rows from resolved tickets (`resolved`) and open tickets
 * (`open`). `slaFields` [{ id, name }] and `satisfactionId` come from settings
 * and the site's fields; `urgent` is the set of priority names counted as
 * urgent (P1/P2 by default). `now` dates the open tickets' age.
 */
export function agentRows(resolved, open, { slaFields = [], satisfactionId = null, urgent = ['P1', 'P2', 'Highest', 'High', 'Critical'], now = Date.now() } = {}) {
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
  };
}

/** Team totals over agent rows (what everyone sees), from the same tickets. */
export function teamTotals(resolved, open, options = {}) {
  const asTeam = (issues) => (issues || []).map((i) => ({ ...i, fields: { ...i.fields, assignee: { accountId: 'team', displayName: 'Team' } } }));
  const [total] = agentRows(asTeam(resolved), asTeam(open), options);
  const agents = new Set([...(resolved || []), ...(open || [])].map((i) => agentOf(i).id).filter((id) => id !== 'unassigned'));
  return { ...(total || summarise(emptyRow({ id: 'team', name: 'Team' }))), agents: agents.size };
}
