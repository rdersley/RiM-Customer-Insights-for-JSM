// The app's one five-minute scheduled trigger (Forge allows only one per app):
// live surge detection first, then AI ticket summaries with the time left.
import { scheduler as surgeScheduler } from './surgeJobs.js';
import { runOnce as summariseTickets } from './ticketSummaryJobs.js';

// Under the five-minute interval (function timeout 280s), so runs don't overlap.
const BUDGET_MS = 230000;
// Not worth starting summaries with less than this left.
const MIN_SUMMARY_MS = 30000;

export async function runFiveMinuteJobs({ surge = surgeScheduler, summaries = summariseTickets, clock = Date.now } = {}) {
  const startedAt = clock();
  try {
    await surge();
  } catch (error) {
    console.error(`fiveMinute: surge detection failed: ${error.message}`);
  }
  const left = BUDGET_MS - (clock() - startedAt);
  if (left < MIN_SUMMARY_MS) {
    console.log(`fiveMinute: ${Math.round(left / 1000)}s left after surge detection, ticket summaries wait for the next run`);
    return;
  }
  try {
    await summaries({ budgetMs: left });
  } catch (error) {
    console.error(`fiveMinute: ticket summaries failed: ${error.message}`);
  }
}

export const scheduler = async () => { await runFiveMinuteJobs(); };
