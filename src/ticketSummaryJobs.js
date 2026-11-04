// AI ticket summaries (src/ticketSummary.js), run from the five-minute trigger
// (src/fiveMinuteJobs.js): summarise tickets from the chosen organisations that changed and
// have been quiet for a while, then spend any time left on the "summarise
// existing tickets" backfill. Reads and writes Jira as the app.
import { asApp, route } from '@forge/api';
import { pool, readJson, requestWithRetry } from './engine.js';
import { QUIET_MINUTES, SUMMARY_PROPERTY, backfillJql, changedJql, fieldValue, hasContent, hash, ready, sourceFingerprint, summaryInput } from './ticketSummary.js';
import { summariseTicket } from './ticketSummaryAi.js';
import * as storage from './storage.js';

// Under the five-minute interval, so runs don't overlap.
const BUDGET_MS = 230000;
const CONCURRENCY = 3;
const PAGE = 25;
// First run, or after a long gap: look back this far at most.
const MAX_LOOKBACK_MINUTES = 24 * 60;
const json = { Accept: 'application/json', 'Content-Type': 'application/json' };

const send = (path, init = {}) => requestWithRetry(() => asApp().requestJira(path, { headers: json, ...init }));

/** Jira calls the job needs, as the app. Tests pass their own. */
export function appJira() {
  return {
    async search(jql, fieldId, nextPageToken) {
      const body = { jql, maxResults: PAGE, fields: ['summary', 'status', 'created', 'updated', 'description', 'comment', 'customfield_10010', fieldId], properties: [SUMMARY_PROPERTY] };
      if (nextPageToken) body.nextPageToken = nextPageToken;
      const data = await readJson(await send(route`/rest/api/3/search/jql`, { method: 'POST', body: JSON.stringify(body) }), 'Ticket search');
      return { issues: data.issues || [], nextPageToken: data.nextPageToken || '' };
    },
    // Comments shared with the customer only: the service desk API leaves internal ones out.
    async publicComments(key) {
      const comments = [];
      let start = 0;
      for (;;) {
        const response = await send(route`/rest/servicedeskapi/request/${key}/comment?public=true&internal=false&start=${start}&limit=50`);
        if (response.status === 404) return comments; // not a service request
        const data = await readJson(response, 'Request comments');
        comments.push(...(data.values || []).filter((c) => c?.public === true));
        if (data.isLastPage !== false || !(data.values || []).length) return comments;
        start += data.values.length;
      }
    },
    // The field needn't be on the edit screen when the app may override it;
    // otherwise it has to be, and the edit is sent again without the overrides.
    async writeField(key, fieldId, value) {
      const body = JSON.stringify({ fields: { [fieldId]: value } });
      let response = await send(route`/rest/api/3/issue/${key}?notifyUsers=false&overrideScreenSecurity=true&overrideEditableFlag=true`, { method: 'PUT', body });
      if (response.status === 403) response = await send(route`/rest/api/3/issue/${key}`, { method: 'PUT', body });
      if (!response.ok) throw new Error(`Writing the summary to ${key} failed (${response.status}): ${(await response.text()).slice(0, 200)}`);
    },
    async setProperty(key, value) {
      const response = await send(route`/rest/api/3/issue/${key}/properties/${SUMMARY_PROPERTY}`, { method: 'PUT', body: JSON.stringify(value) });
      if (!response.ok) throw new Error(`Saving the summary marker on ${key} failed (${response.status}).`);
    },
  };
}

/**
 * Summarises one ticket if its customer-visible text changed since the last
 * summary. Returns 'summarised', 'unchanged' or 'empty'.
 */
export async function summariseIssue(issue, config, deps) {
  const { jira, summarise = summariseTicket, now = () => new Date() } = deps;
  const marker = issue.properties?.[SUMMARY_PROPERTY] || {};
  const source = sourceFingerprint(issue.fields);
  if (marker.source === source) return 'unchanged';
  const input = summaryInput(issue, await jira.publicComments(issue.key));
  const inputHash = hash(JSON.stringify(input));
  const sentChars = JSON.stringify(input).length;
  // Only internal comments changed: nothing new for the customer.
  if (marker.input === inputHash) {
    await jira.setProperty(issue.key, { ...marker, source });
    return 'unchanged';
  }
  if (!hasContent(input)) {
    await jira.setProperty(issue.key, { v: 1, source, input: inputHash, at: marker.at || null });
    return 'empty';
  }
  const { summary, model } = await summarise(input);
  deps.onSent?.(sentChars); // for the run log: what the AI was sent, to watch the cost
  await jira.writeField(issue.key, config.fieldId, fieldValue(summary, config.fieldKind));
  await jira.setProperty(issue.key, { v: 1, source, input: inputHash, at: now().toISOString(), model });
  return 'summarised';
}

/** Runs summariseIssue over a page with a few in flight; failures are counted, not thrown. */
async function processPage(issues, config, deps, tally, deadline, clock) {
  let processed = 0;
  await pool(issues.map((issue) => async () => {
    if (clock() > deadline) return;
    try {
      tally[await summariseIssue(issue, config, deps)] += 1;
    } catch (error) {
      tally.failed += 1;
      tally.lastError = `${issue.key}: ${String(error.message || error).slice(0, 200)}`;
      console.error(`ticketSummary: ${tally.lastError}`);
    }
    processed += 1;
  }), CONCURRENCY);
  return processed === issues.length;
}

export async function runOnce({ jira = appJira(), store = storage, summarise = summariseTicket, clock = Date.now, budgetMs = BUDGET_MS } = {}) {
  const settings = await store.loadSettings();
  const config = settings.ticketSummary;
  if (!ready(config)) return null;
  const startedAt = clock();
  const deadline = startedAt + budgetMs;
  const state = await store.loadTicketSummaryState();
  const tally = { summarised: 0, unchanged: 0, empty: 0, failed: 0, chars: 0, lastError: state.last?.lastError || '' };
  const deps = { jira, summarise, onSent: (n) => { tally.chars += n; } };

  // 1. Tickets changed since the last run (with a few minutes' overlap).
  const since = state.cursorAt ? Math.min(MAX_LOOKBACK_MINUTES, (startedAt - state.cursorAt) / 60000 + 3) : QUIET_MINUTES + 20;
  const jql = changedJql(config.organizations, since);
  let token = '';
  let complete = true;
  do {
    const page = await jira.search(jql, config.fieldId, token);
    if (!(await processPage(page.issues, config, deps, tally, deadline, clock))) { complete = false; break; }
    token = page.nextPageToken;
  } while (token && clock() < deadline);
  if (token) complete = false;
  // The window ends QUIET_MINUTES ago; only move on once everything in it is done.
  const cursorAt = complete ? startedAt - QUIET_MINUTES * 60000 : state.cursorAt || startedAt - (QUIET_MINUTES + 30) * 60000;

  // 2. The backfill, with whatever time is left.
  let backfill = state.backfill;
  if (backfill?.running && clock() < deadline - 20000) {
    const counts = { summarised: 0, unchanged: 0, empty: 0, failed: 0 };
    let next = backfill.nextPageToken || '';
    let finished = false;
    while (clock() < deadline - 20000) {
      const page = await jira.search(backfillJql(config.organizations, backfill.days), config.fieldId, next);
      const before = { ...tally };
      const done = await processPage(page.issues, config, deps, tally, deadline, clock);
      for (const k of Object.keys(counts)) counts[k] += tally[k] - before[k];
      if (!done) break; // out of time mid-page: the page runs again next time
      next = page.nextPageToken;
      if (!next) { finished = true; break; }
    }
    backfill = {
      ...backfill,
      nextPageToken: finished ? '' : next,
      running: !finished,
      finishedAt: finished ? new Date(clock()).toISOString() : null,
      checked: (backfill.checked || 0) + counts.summarised + counts.unchanged + counts.empty + counts.failed,
      summarised: (backfill.summarised || 0) + counts.summarised,
      failed: (backfill.failed || 0) + counts.failed,
    };
  }

  const last = { at: new Date(startedAt).toISOString(), ms: clock() - startedAt, ...tally };
  await store.saveTicketSummaryState({ ...state, cursorAt, backfill, last, totalSummarised: (state.totalSummarised || 0) + tally.summarised });
  console.log(`ticketSummary: ${JSON.stringify(last)}${backfill?.running ? ` backfill ${backfill.checked} checked` : ''}`);
  return last;
}

