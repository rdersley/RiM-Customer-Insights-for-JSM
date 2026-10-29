// Weekly SD report jobs (src/weekly.js). The hourly scheduler (liveJobs.js)
// queues last week's report once the week is over; agents can rebuild any of
// the last 12 weeks. The queue consumer reads Jira as the app: every ticket of
// the report's organisations created or resolved since the start of the week
// before, the open backlog now, and the history of resolved tickets for the
// workload. Agents' notes and the portal setting survive a rebuild.
import { asApp, route } from '@forge/api';
import { countIssues, fetchHistories, readJson, requestWithRetry } from './engine.js';
import { handlingTimes } from './agents.js';
import { organisationBreakdown, readValues } from './settings.js';
import { EMPTY_NOTES, isMonday, lastWeek, previousWeek, stepsOf, weekOf, weeklyReport, weeklyTicket, WEEKS_KEPT } from './weekly.js';
import { deleteWeekly, listWeekly, loadSettings, loadWeekly, saveWeekly } from './storage.js';
import { carriedActions, notesAfterBuild, suggestWeeklyNotes } from './weeklyAi.js';

const MAX_TICKETS = 20000;
const JOB_BUDGET_MS = 600000; // the consumer has 15 minutes
const QUEUED_FOR_MS = 3600000; // a queued build not finished within an hour is queued again

const quote = (v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** JQL for a report's tickets: its organisations, and its projects when set. */
export function scopeJql(config, organizations = config.organizations) {
  const orgs = organizations.length === 1 ? `organizations = ${quote(organizations[0].name)}` : `organizations in (${organizations.map((o) => quote(o.name)).join(', ')})`;
  return config.projects?.length ? `${orgs} AND project in (${config.projects.map((k) => `'${k}'`).join(', ')})` : orgs;
}

/** Whether the scheduler should queue this week: not built, not failed recently, not queued in the last hour. */
export function isWeeklyDue(record, now = Date.now()) {
  if (record?.builtAt) return false;
  if (record?.queuedAt && now - Date.parse(record.queuedAt) < QUEUED_FOR_MS) return false;
  if (record?.lastErrorAt && now - Date.parse(record.lastErrorAt) < 6 * QUEUED_FOR_MS) return false;
  return true;
}

/** The record to save while a week is waiting to be built. */
export const queuedRecord = (config, week, existing, at = new Date().toISOString()) => ({
  notes: EMPTY_NOTES, publishedAt: null, ...existing, id: config.id, name: config.name, week: { from: week.from, to: week.to }, queuedAt: at,
});

const queue = async () => new (await import('@forge/events')).Queue({ key: 'live-report-refresh' });

/** Queues one week of one report (the scheduler, or an agent's rebuild). */
export async function queueWeekly(config, week) {
  await (await queue()).push({ body: { type: 'weekly', reportId: config.id, from: week.from } });
  await saveWeekly(queuedRecord(config, week, await loadWeekly(config.id, week.from)));
  console.log(`weekly: queued ${config.id} ${week.from}`);
}

/** Hourly: queue last week for each report not built yet, and drop weeks older than 12. */
export async function scheduleWeekly(now = Date.now()) {
  const { weekly } = await loadSettings();
  const reports = weekly?.reports || [];
  const week = lastWeek(now);
  const oldest = weekOf(new Date(Date.parse(`${week.from}T00:00:00Z`) - (WEEKS_KEPT - 1) * 7 * 86400000).toISOString().slice(0, 10));
  const ids = new Set(reports.map((r) => r.id));
  let queued = 0;
  for (const record of await listWeekly()) {
    if (!ids.has(record.id) || record.week.from < oldest.from) await deleteWeekly(record.id, record.week.from);
  }
  for (const config of reports) {
    if (!isWeeklyDue(await loadWeekly(config.id, week.from), now)) continue;
    await queueWeekly(config, week);
    queued += 1;
  }
  if (reports.length) console.log(`weekly: scheduler checked ${reports.length}, queued ${queued}`);
}

async function jiraJson(path, label) {
  return readJson(await requestWithRetry(() => asApp().requestJira(path, { headers: { Accept: 'application/json' } })), label);
}

/** Every ticket for `jql` with `fields`, newest first, up to MAX_TICKETS. */
async function searchAll(jql, fields, deadline) {
  const issues = [];
  let token;
  do {
    if (Date.now() > deadline) throw new Error('Reading the tickets took too long.');
    const body = { jql: `${jql} ORDER BY created DESC`, maxResults: 100, fields, ...(token ? { nextPageToken: token } : {}) };
    const page = await readJson(await requestWithRetry(() => asApp().requestJira(route`/rest/api/3/search/jql`, {
      method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })), 'Ticket search');
    issues.push(...(page.issues || []));
    token = page.nextPageToken;
  } while (token && issues.length < MAX_TICKETS);
  if (token) throw new Error(`More than ${MAX_TICKETS} tickets in two weeks; narrow the report to fewer organisations or projects.`);
  return issues;
}

/** The organisations as Jira names them now (searches use names; renames are followed). */
async function currentOrganisations(config) {
  return Promise.all(config.organizations.map(async (o) => {
    try {
      const data = await jiraJson(route`/rest/servicedeskapi/organization/${o.id}`, 'Organization lookup');
      return String(data.id) === o.id && data.name ? { id: o.id, name: String(data.name) } : o;
    } catch {
      return o;
    }
  }));
}

/** Up to 6 summaries of tickets created in the week, for each of the 5 biggest categories (AI input only; not stored). */
export function examplesOf(issues, tickets, week) {
  const byCategory = new Map();
  tickets.forEach((t, i) => {
    if (t.created < week.start || t.created >= week.end) return;
    const list = byCategory.get(t.category) || [];
    if (list.length < 6 && issues[i]?.fields?.summary) list.push(String(issues[i].fields.summary));
    byCategory.set(t.category, list);
  });
  const counts = new Map();
  tickets.forEach((t) => { if (t.created >= week.start && t.created < week.end) counts.set(t.category, (counts.get(t.category) || 0) + 1); });
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name]) => name);
  return Object.fromEntries(top.map((name) => [name, byCategory.get(name) || []]));
}

export async function buildWeekly(reportId, from) {
  if (!isMonday(from)) return { skipped: 'not a week' };
  const startedAt = Date.now();
  const deadline = startedAt + JOB_BUDGET_MS;
  const { weekly, handlingStatuses = [] } = await loadSettings();
  const stored = (weekly?.reports || []).find((r) => r.id === reportId);
  if (!stored) return { skipped: 'no such report' };
  const week = weekOf(from);
  try {
    const config = { ...stored, organizations: await currentOrganisations(stored) };
    const before = previousWeek(week);
    // A day early: JQL dates are in the site's time zone, the week in Irish time.
    const since = new Date(Date.parse(`${before.from}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    const scope = scopeJql(config);
    const [fieldList, statuses] = await Promise.all([jiraJson(route`/rest/api/3/field`, 'Field list'), jiraJson(route`/rest/api/3/status`, 'Statuses')]);
    const orgFieldId = organisationBreakdown(fieldList, [])?.id || null;
    const fields = ['summary', 'created', 'resolutiondate', 'timespent', 'status', 'assignee', orgFieldId, config.categoryField?.id, config.subcategoryField?.id].filter(Boolean);
    const [issues, openAll, ...openByOrg] = await Promise.all([
      searchAll(`${scope} AND (created >= "${since}" OR resolved >= "${since}")`, fields, deadline),
      countIssues(`${scope} AND resolution = Unresolved`, 'app'),
      ...(config.organizations.length > 1 ? config.organizations.map((o) => countIssues(`${scopeJql(config, [o])} AND resolution = Unresolved`, 'app')) : []),
    ]);
    const tickets = issues.map((issue) => weeklyTicket(issue, { orgFieldId, categoryField: config.categoryField, subcategoryField: config.subcategoryField, readValues }));
    // Workload: history of the tickets resolved in either week.
    const resolvedIssues = issues.filter((issue) => {
      const at = Date.parse(issue.fields?.resolutiondate);
      return Number.isFinite(at) && at >= before.start && at < week.end;
    });
    const { histories } = await fetchHistories(resolvedIssues, ['status', 'assignee'], deadline, 'app');
    const statusById = new Map((Array.isArray(statuses) ? statuses : []).map((s) => [String(s.id), { name: s.name, category: s.statusCategory?.key }]));
    const effort = {};
    for (const issue of resolvedIssues) {
      const list = histories.get(String(issue.id));
      if (!list) continue;
      const handlingMs = Object.values(handlingTimes(issue, list, statusById, handlingStatuses)).reduce((n, ms) => n + ms, 0);
      effort[String(issue.id)] = { handlingMs, ...stepsOf(list) };
    }
    const report = weeklyReport({
      config, week, tickets, effort, handlingStatuses,
      openNow: { all: openAll, byOrg: Object.fromEntries(openByOrg.map((n, i) => [config.organizations[i].name, n])) },
    });
    // Insights and actions for the agents: AI suggestions plus last week's open actions.
    const previous = await loadWeekly(reportId, before.from);
    const suggested = config.aiNotes === false
      ? { insights: '', actions: carriedActions(previous), at: new Date().toISOString(), model: null, error: null }
      : await suggestWeeklyNotes(report, { examples: examplesOf(issues, tickets, week), previous });
    // Keep the notes agents saved and the portal setting.
    const existing = await loadWeekly(reportId, week.from);
    await saveWeekly({ publishedAt: null, ...existing, ...report, notes: notesAfterBuild(existing, suggested), suggested, queuedAt: null, lastError: null, lastErrorAt: null });
    console.log(`weekly: built ${reportId} ${week.from} in ${Date.now() - startedAt}ms, ${issues.length} tickets, ${resolvedIssues.length} resolved (${Object.keys(effort).length} with history)`);
    return { built: true };
  } catch (error) {
    const existing = await loadWeekly(reportId, week.from);
    await saveWeekly({ notes: EMPTY_NOTES, publishedAt: null, ...existing, id: reportId, name: stored.name, week: { from: week.from, to: week.to }, queuedAt: null, lastError: String(error.message || error).slice(0, 300), lastErrorAt: new Date().toISOString() });
    console.error(`weekly: build failed for ${reportId} ${week.from}: ${error.message}`);
    return { failed: true };
  }
}
