// Open tickets are summarised again at most every refreshHours (resolved ones
// straight away); a catch-up window refreshHours later picks up what was deferred.
import test from 'node:test';
import assert from 'node:assert/strict';
import { REFRESH_LIMITS, SUMMARY_PROPERTY, changedJql, refreshHoursOf, sanitizeTicketSummary, shouldDefer } from '../src/ticketSummary.js';
import { runOnce, summariseIssue } from '../src/ticketSummaryJobs.js';
import { DEFAULT_SETTINGS } from '../src/settings.js';

const ORG = { id: '188', name: 'Ryanair Crew' };
const NOW = Date.parse('2026-11-23T12:00:00Z');
const hoursAgo = (h) => new Date(NOW - h * 3600000).toISOString();
const ticket = (key, { status = 'indeterminate', marker } = {}) => ({
  key,
  fields: { summary: 'FW: urgent', status: { name: 'Waiting for support', statusCategory: { key: status } }, created: '2026-11-23T08:00:00.000+0000', description: 'vPOS at STN stuck on sync since this morning.', comment: { total: 0, comments: [] } },
  properties: marker ? { [SUMMARY_PROPERTY]: marker } : {},
});
const config = { enabled: true, organizations: [ORG], fieldId: 'customfield_200', fieldKind: 'textarea', backfillDays: 30, refreshHours: 4 };
const jiraFor = (byWindow) => {
  const calls = { search: [], writes: [] };
  return {
    calls,
    async search(jql) { calls.search.push(jql); const hit = Object.entries(byWindow).find(([p]) => jql.includes(p)); return { issues: hit ? hit[1] : [], nextPageToken: '' }; },
    async publicComments() { return []; },
    async writeField(key) { calls.writes.push(key); },
    async setProperty() {},
  };
};
const summarise = async () => ({ summary: 'The vPOS at STN is stuck on sync; support is investigating.', model: 'claude-haiku-4-5-20251001' });

test('settings: 4 hours by default (also for settings saved before), 0–24', () => {
  assert.equal(DEFAULT_SETTINGS.ticketSummary.refreshHours, REFRESH_LIMITS.default);
  assert.equal(refreshHoursOf({}), 4);
  assert.equal(refreshHoursOf({ refreshHours: 0 }), 0);
  assert.equal(sanitizeTicketSummary({ refreshHours: 30 }, [], []).refreshHours, 4);
  assert.equal(sanitizeTicketSummary({ refreshHours: 0 }, [], []).refreshHours, 0);
  assert.equal(sanitizeTicketSummary({ refreshHours: 8 }, [], []).refreshHours, 8);
});

test('defer: open and summarised within the interval; never new or resolved tickets', () => {
  assert.equal(shouldDefer(ticket('SD-1'), { at: hoursAgo(1) }, 4, NOW), true);
  assert.equal(shouldDefer(ticket('SD-1'), { at: hoursAgo(5) }, 4, NOW), false);
  assert.equal(shouldDefer(ticket('SD-1'), {}, 4, NOW), false); // never summarised
  assert.equal(shouldDefer(ticket('SD-1', { status: 'done' }), { at: hoursAgo(1) }, 4, NOW), false);
  assert.equal(shouldDefer(ticket('SD-1'), { at: hoursAgo(1) }, 0, NOW), false);
});

test('catch-up window: the change window shifted back by the interval', () => {
  assert.equal(changedJql([ORG], 28, 240), 'organizations = "Ryanair Crew" AND updated >= -268m AND updated <= -260m ORDER BY updated ASC');
});

test('a busy open ticket is deferred, then summarised once in the catch-up', async () => {
  const recent = { v: 1, source: 'old', at: hoursAgo(1) };
  const old = { v: 1, source: 'old', at: hoursAgo(4.5) };
  const deps = { jira: jiraFor({}), summarise, now: () => new Date(NOW) };
  assert.equal(await summariseIssue(ticket('SD-1', { marker: recent }), config, deps), 'deferred');
  assert.equal(await summariseIssue(ticket('SD-2', { marker: recent, status: 'done' }), config, deps), 'summarised');
  assert.equal(await summariseIssue(ticket('SD-3', { marker: old }), config, deps), 'summarised');

  const jira = jiraFor({ 'updated <= -20m': [ticket('SD-1', { marker: recent })], 'updated <= -260m': [ticket('SD-9', { marker: old })] });
  const state = { cursorAt: NOW - 25 * 60000 };
  const store = { state, async loadSettings() { return { ...DEFAULT_SETTINGS, ticketSummary: config }; }, async loadTicketSummaryState() { return store.state; }, async saveTicketSummaryState(s) { store.state = s; } };
  const last = await runOnce({ jira, store, summarise, clock: () => NOW });
  assert.equal(jira.calls.search.length, 2);
  assert.match(jira.calls.search[1], /updated <= -260m/);
  assert.deepEqual([last.deferred, last.summarised], [1, 1]);
  assert.deepEqual(jira.calls.writes, ['SD-9']);
});
