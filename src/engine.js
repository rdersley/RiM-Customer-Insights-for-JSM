// The analysis engine, shared by the agent page (Jira read as the user) and
// live portal reports (read as the app, in a queued background job).
import { asApp, asUser, route } from '@forge/api';
import { buildReport, chartBuckets } from './analysis.js';
import { dimensionsOf, jqlClause } from './settings.js';
import { validTimeZone } from './timeOfDay.js';

export const DAY = 86400000;
const PERIOD_SAMPLE = 900; // most tickets analysed per period (groupIssues' cap)
const SAMPLE_SLICES = 9;
const CONCURRENCY = 6;
const FIELDS = ['summary', 'description', 'created', 'status', 'resolutiondate'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 'user' (default) respects the signed-in user's permissions; 'app' is for background jobs. */
const jira = (mode) => (mode === 'app' ? asApp() : asUser());

export async function readJson(response, label) {
  const body = await response.text();
  if (!response.ok) throw new Error(`${label} failed (${response.status}): ${body.slice(0, 350)}`);
  return body ? JSON.parse(body) : {};
}

const RETRIES = 3;
const MAX_WAIT_MS = 8000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait before retry `attempt` (0-based): Jira's Retry-After when given, else 1s, 2s, 4s. */
export function retryDelay(response, attempt) {
  const header = Number(response?.headers?.get?.('Retry-After'));
  const ms = Number.isFinite(header) && header > 0 ? header * 1000 : 1000 * 2 ** attempt;
  return Math.min(ms, MAX_WAIT_MS);
}

/** requestJira that retries rate limits (429) and brief outages (503). */
export async function requestWithRetry(send, { retries = RETRIES, wait = sleep } = {}) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await send();
    if (![429, 503].includes(response.status) || attempt >= retries) return response;
    const delay = retryDelay(response, attempt);
    console.log(`jira: ${response.status}, retry ${attempt + 1}/${retries} in ${delay}ms`);
    await wait(delay);
  }
}

async function jiraPost(path, body, label, mode) {
  const response = await requestWithRetry(() => jira(mode).requestJira(path, {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));
  return readJson(response, label);
}

/** Jira's fast count (not a full search). Permissions apply as for search. */
export async function countIssues(jql, mode) {
  const result = await jiraPost(route`/rest/api/3/search/approximate-count`, { jql }, 'Ticket count', mode);
  return Number(result.count) || 0;
}

/** A page of issues, each with `dims` for the admin-chosen breakdown fields. */
export async function searchPage(jql, maxResults, nextPageToken, breakdowns = [], mode) {
  const body = { jql: `${jql} ORDER BY created DESC`, maxResults, fields: [...FIELDS, ...breakdowns.map((b) => b.id)] };
  if (nextPageToken) body.nextPageToken = nextPageToken;
  const result = await jiraPost(route`/rest/api/3/search/jql`, body, 'Ticket search', mode);
  const issues = (result.issues || []).map((issue) => ({ ...issue, dims: dimensionsOf(issue, breakdowns) }));
  return { issues, nextPageToken: result.nextPageToken };
}

/** Runs async tasks with at most `limit` in flight, keeping result order. */
export async function pool(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

/** Splits [from, toExclusive) into up to n whole-day slices. */
export function dateSlices(from, toExclusive, n) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const days = Math.max(1, Math.round((Date.parse(`${toExclusive}T00:00:00Z`) - start) / DAY));
  const count = Math.min(n, days);
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  return Array.from({ length: count }, (_, i) => [iso(start + Math.floor((i * days) / count) * DAY), iso(start + Math.floor(((i + 1) * days) / count) * DAY)]);
}

function escapeJql(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * A drill-down filter ({ id, value }) as JQL. Only configured breakdown fields
 * are accepted and the JQL is built here, never taken from the client.
 */
export function filterFor(payloadFilter, breakdowns) {
  if (!payloadFilter) return null;
  const field = breakdowns.find((b) => b.id === String(payloadFilter.id));
  const value = String(payloadFilter.value ?? '').slice(0, 120);
  const clause = field && jqlClause(field, value);
  if (!clause) throw new Error('That filter isn’t available. Check the breakdown fields in Customer Insights settings.');
  return { id: field.id, label: field.label, value, clause };
}

export const MAX_ORGANISATIONS = 10;

/**
 * The organisations an analysis covers: payload.organizations (up to 10), or
 * the single payload.organization older pages and background jobs send.
 */
export function organisationsOf(payload) {
  const list = Array.isArray(payload?.organizations) && payload.organizations.length ? payload.organizations : [payload?.organization];
  const seen = new Set();
  const clean = list
    .filter((o) => o && String(o.name ?? '').trim())
    .map((o) => ({ ...(o.id !== undefined ? { id: String(o.id) } : {}), name: String(o.name).trim().slice(0, 200) }))
    .filter((o) => !seen.has(o.name) && seen.add(o.name));
  if (clean.length > MAX_ORGANISATIONS) throw new Error(`Choose up to ${MAX_ORGANISATIONS} organisations at a time.`);
  return clean;
}

/** Validates an analysis request and builds its JQL. */
export function parseQuery(payload, filter = null) {
  const { startDate, endDate, projects = [] } = payload || {};
  const organizations = organisationsOf(payload);
  const organization = organizations[0];
  if (!organization || !ISO_DATE.test(startDate || '') || !ISO_DATE.test(endDate || '')) {
    throw new Error('Choose an organization and valid start and end dates.');
  }
  const orgClause = organizations.length === 1
    ? `organizations = "${escapeJql(organization.name)}"`
    : `organizations in (${organizations.map((o) => `"${escapeJql(o.name)}"`).join(', ')})`;
  if (Number.isNaN(Date.parse(startDate)) || Number.isNaN(Date.parse(endDate))) throw new Error('Choose valid calendar dates.');
  if (startDate > endDate) throw new Error('Start date must be on or before end date.');
  const span = (Date.parse(endDate) - Date.parse(startDate)) / DAY;
  if (span > 365) throw new Error('Choose a period of 365 days or less for this first version.');
  const requestedProjects = Array.isArray(projects) ? projects : [];
  const cleanProjects = [...new Set(requestedProjects.map((key) => String(key).trim().toUpperCase()).filter((key) => /^[A-Z][A-Z0-9_]{0,49}$/.test(key)))];
  if (requestedProjects.length && !cleanProjects.length) throw new Error('Enter one or more valid Jira project keys, such as SD or HW.');
  const projectClause = cleanProjects.length ? ` AND project in (${cleanProjects.map((key) => `'${key}'`).join(', ')})` : '';
  const filterClause = filter ? ` AND ${filter.clause}` : '';
  const fullSpan = Math.max(1, span + 1);
  return {
    organization,
    organizations,
    startDate,
    endDate,
    cleanProjects,
    filter,
    // The agent's time zone, for when tickets are created; UTC for background jobs.
    timeZone: validTimeZone(payload?.timeZone),
    previousStart: new Date(Date.parse(`${startDate}T00:00:00Z`) - fullSpan * DAY).toISOString().slice(0, 10),
    endExclusive: new Date(Date.parse(`${endDate}T00:00:00Z`) + DAY).toISOString().slice(0, 10),
    between: (from, toExclusive) => `${orgClause} AND created >= "${from}" AND created < "${toExclusive}"${projectClause}${filterClause}`,
  };
}

/**
 * Exact totals, an even sample of up to 900 tickets per period, and the
 * report. `budgetMs` stops new fetches in time for the caller's limit.
 */
export async function runAnalysis(query, { breakdowns = [], minPatternSize, placeholders, synonyms, mode = 'user', budgetMs = 15000 } = {}) {
  const { startDate, endDate, previousStart, endExclusive, between } = query;
  const startedAt = Date.now();
  const deadline = startedAt + budgetMs;
  let cutShort = false;

  // Exact totals first, so headline numbers and the comparison never depend on the sample.
  const [currentTotal, previousTotal] = await Promise.all([
    countIssues(between(startDate, endExclusive), mode),
    countIssues(between(previousStart, startDate), mode),
  ]);

  // Small periods are fetched in full. Large ones are sampled evenly: the newest
  // tickets of each of SAMPLE_SLICES slices, so June counts as much as August.
  async function fetchPeriod(from, toExclusive, total) {
    if (total <= PERIOD_SAMPLE) {
      const issues = [];
      let token;
      do {
        if (Date.now() > deadline) { cutShort = true; break; }
        const page = await searchPage(between(from, toExclusive), 100, token, breakdowns, mode);
        issues.push(...page.issues);
        token = page.nextPageToken;
      } while (token && issues.length < PERIOD_SAMPLE);
      return issues;
    }
    const perSlice = Math.min(100, Math.ceil(PERIOD_SAMPLE / SAMPLE_SLICES));
    const pages = await pool(dateSlices(from, toExclusive, SAMPLE_SLICES).map(([a, b]) => () => {
      if (Date.now() > deadline) { cutShort = true; return { issues: [] }; }
      return searchPage(between(a, b), perSlice, undefined, breakdowns, mode);
    }), CONCURRENCY);
    return pages.flatMap((page) => page.issues);
  }
  const [currentIssues, previousIssues] = await Promise.all([
    fetchPeriod(startDate, endExclusive, currentTotal),
    fetchPeriod(previousStart, startDate, previousTotal),
  ]);

  // A sampled period can't draw its own chart, so count each bucket instead.
  let timeSeries;
  if (currentIssues.length < currentTotal) {
    const buckets = chartBuckets(startDate, endDate);
    const counts = await pool(buckets.map((b) => () => countIssues(between(b.from, b.toExclusive), mode)), CONCURRENCY);
    timeSeries = buckets.map((b, i) => ({ date: b.date, count: counts[i] }));
  }
  const issues = [...currentIssues, ...previousIssues];
  const report = buildReport(issues, startDate, endDate, { current: currentTotal, previous: previousTotal, timeSeries }, { breakdowns, minPatternSize, placeholders, synonyms, timeZone: query.timeZone });
  console.log(`analysis (${mode}): ${currentTotal}+${previousTotal} tickets, ${issues.length} fetched in ${Date.now() - startedAt}ms`);
  return {
    ...report,
    organization: query.organizations.map((o) => o.name).join(', '),
    organizations: query.organizations,
    startDate, endDate, previousStart, endExclusive,
    projectCount: query.cleanProjects.length || null, totalFetched: issues.length, cutShort,
    breakdownFields: breakdowns.map(({ id, label, kind }) => ({ id, label, kind })),
    // For "Open in Jira" links: the period's search, and any drill-down filter.
    baseJql: between(startDate, endExclusive),
    filter: query.filter ? { id: query.filter.id, label: query.filter.label, value: query.filter.value } : null,
  };
}
