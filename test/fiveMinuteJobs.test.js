import test from 'node:test';
import assert from 'node:assert/strict';
import { runFiveMinuteJobs } from '../src/fiveMinuteJobs.js';

test('surge detection runs first, then ticket summaries with the time left', async () => {
  const order = [];
  let t = 0;
  await runFiveMinuteJobs({
    clock: () => t,
    surge: async () => { order.push('surge'); t += 20000; },
    summaries: async ({ budgetMs }) => { order.push(['summaries', budgetMs]); },
  });
  assert.deepEqual(order, ['surge', ['summaries', 210000]]);
});

test('a surge failure does not stop ticket summaries', async () => {
  let ran = false;
  await runFiveMinuteJobs({ clock: () => 0, surge: async () => { throw new Error('boom'); }, summaries: async () => { ran = true; } });
  assert.equal(ran, true);
});

test('summaries wait for the next run when surge detection used most of the time', async () => {
  let t = 0;
  let ran = false;
  await runFiveMinuteJobs({ clock: () => t, surge: async () => { t += 210000; }, summaries: async () => { ran = true; } });
  assert.equal(ran, false);
});

test('the manifest has one fiveMinute trigger', async () => {
  const { readFileSync } = await import('node:fs');
  const manifest = readFileSync(new URL('../manifest.yml', import.meta.url), 'utf8');
  assert.equal((manifest.match(/interval: fiveMinute/g) || []).length, 1);
});
