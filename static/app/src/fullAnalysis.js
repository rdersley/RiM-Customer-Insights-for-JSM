// "Analyse every ticket": pages through both periods with the fetchTickets
// resolver (Jira read as the user, one date slice at a time so each call stays
// inside Forge's 25s limit), then groups every ticket in the browser.
import { invoke } from '@forge/bridge';
import { buildReport } from '../../../src/analysis.js';

export const FULL_LIMIT = 15000; // tickets per period
const TICKETS_PER_SLICE = 400;
const CONCURRENCY = 4; // parallel resolver calls; keeps Jira rate limits comfortable
const DAY = 86400000;

function dateSlices(from, toExclusive, n) {
  const start = Date.parse(`${from}T00:00:00Z`);
  const days = Math.max(1, Math.round((Date.parse(`${toExclusive}T00:00:00Z`) - start) / DAY));
  const count = Math.max(1, Math.min(n, days));
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
  return Array.from({ length: count }, (_, i) => [iso(start + Math.floor((i * days) / count) * DAY), iso(start + Math.floor(((i + 1) * days) / count) * DAY)]);
}

async function pool(tasks, limit) {
  let next = 0;
  const worker = async () => { while (next < tasks.length) await tasks[next++](); };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
}

function groupOnPage(args) {
  return buildReport(args.issues, args.startDate, args.endDate, null, { limit: Infinity, breakdowns: args.breakdowns || [], minPatternSize: args.minPatternSize, placeholders: args.placeholders || [], timeZone: args.timeZone });
}

/** Groups in a Web Worker so the page stays responsive; falls back to the page. */
function group(args) {
  return new Promise((resolve, reject) => {
    let worker;
    try {
      worker = new Worker(new URL('./groupWorker.js', import.meta.url), { type: 'module' });
    } catch {
      resolve(groupOnPage(args));
      return;
    }
    worker.onmessage = ({ data }) => {
      worker.terminate();
      if (data.error) reject(new Error(data.error));
      else resolve(data.report);
    };
    worker.onerror = (event) => {
      event.preventDefault?.();
      worker.terminate();
      try { resolve(groupOnPage(args)); } catch (error) { reject(error); }
    };
    worker.postMessage(args);
  });
}

export class Cancelled extends Error {}

/**
 * query: the analyze payload ({ organization, startDate, endDate, projects });
 * sampled: the sampled report (for totals and the period boundaries).
 * onProgress(fetched, total, phase) is called as tickets arrive.
 */
export async function analyseEveryTicket({ query, sampled, onProgress, isCancelled }) {
  const total = sampled.currentCount + sampled.previousCount;
  const periods = [
    [sampled.startDate, sampled.endExclusive, sampled.currentCount],
    [sampled.previousStart, sampled.startDate, sampled.previousCount],
  ];
  const issues = [];
  const tasks = periods.flatMap(([from, toExclusive, count]) => (count
    ? dateSlices(from, toExclusive, Math.ceil(count / TICKETS_PER_SLICE)).map(([a, b]) => async () => {
      let nextPageToken = null;
      do {
        if (isCancelled()) throw new Cancelled('Cancelled');
        const page = await invoke('fetchTickets', { ...query, from: a, toExclusive: b, nextPageToken });
        issues.push(...page.tickets);
        nextPageToken = page.nextPageToken;
        onProgress(issues.length, total, 'fetching');
      } while (nextPageToken);
    })
    : []));
  await pool(tasks, CONCURRENCY);
  if (isCancelled()) throw new Cancelled('Cancelled');
  onProgress(issues.length, total, 'grouping');
  const report = await group({ issues, startDate: sampled.startDate, endDate: sampled.endDate, breakdowns: sampled.breakdownFields || [], minPatternSize: sampled.minPatternSize, placeholders: sampled.placeholders || [], timeZone: sampled.timeOfDay?.timeZone });
  return {
    ...report,
    organization: sampled.organization,
    startDate: sampled.startDate,
    endDate: sampled.endDate,
    previousStart: sampled.previousStart,
    endExclusive: sampled.endExclusive,
    projectCount: sampled.projectCount,
    totalFetched: issues.length,
    breakdownFields: sampled.breakdownFields,
    baseJql: sampled.baseJql,
    filter: sampled.filter,
    full: true,
  };
}
