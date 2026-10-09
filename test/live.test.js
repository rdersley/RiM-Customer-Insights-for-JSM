import test from 'node:test';
import assert from 'node:assert/strict';
import { assignByWords, isDue, isLive, liveConfigFrom, liveCounts, livePeriod, nextCustomerRefresh, portalBreakdowns, refreshedSnapshotInput } from '../src/live.js';
import { parseAssignments, assignToApproved } from '../src/ai.js';
import { portalView, snapshotFrom } from '../src/publish.js';

const now = new Date('2026-09-30T12:00:00Z');
const org = { id: '42', name: 'Ryanair Crew' };
const approved = [{ title: 'Open a barset', summary: 'Barset open requests.' }, { title: 'vPOS app freezes', summary: '' }];

test('report config: schedule off keeps the published period; bounded and defaulted', () => {
  const once = liveConfigFrom({ schedule: 'off', period: { from: '2026-06-01', to: '2026-08-31' } }, { organization: org, now });
  assert.equal(isLive(once), false);
  assert.deepEqual(livePeriod(once), { from: '2026-06-01', to: '2026-08-31' });
  assert.throws(() => liveConfigFrom({ schedule: 'off' }, { organization: org, now }), /Invalid period/);
  const config = liveConfigFrom({ schedule: 'weekly', preset: 'bogus', approved: [...approved, { title: '' }], overview: 'Summary.', actions: ['Do x'] }, { organization: org, projects: ['SD'], now });
  assert.equal(config.preset, 'last-30');
  assert.equal(config.approved.length, 2);
  assert.equal(config.summaryWrittenAt, '2026-09-30T12:00:00.000Z');
  assert.deepEqual(config.projects, ['SD']);
  assert.deepEqual(livePeriod({ preset: 'last-month' }, new Date(2026, 8, 30)), { from: '2026-08-01', to: '2026-08-31' });
});

test('refreshes are due by schedule and never queued twice', () => {
  const daily = { schedule: 'daily' };
  assert.equal(isDue(daily, null, now.getTime()), true);
  assert.equal(isDue(daily, { lastRefreshAt: '2026-09-30T02:00:00Z' }, now.getTime()), false);
  assert.equal(isDue(daily, { lastRefreshAt: '2026-09-29T11:00:00Z' }, now.getTime()), true);
  assert.equal(isDue(daily, { lastRefreshAt: '2026-09-29T11:00:00Z', queuedAt: '2026-09-30T11:50:00Z' }, now.getTime()), false);
  assert.equal(isDue({ schedule: 'weekly' }, { lastRefreshAt: '2026-09-26T12:00:00Z' }, now.getTime()), false);
  assert.equal(isDue({ schedule: 'off' }, null, now.getTime()), false);
});

test('customers can refresh at most once an hour', () => {
  assert.equal(nextCustomerRefresh(null, now.getTime()), 0);
  assert.equal(nextCustomerRefresh({ requestedAt: '2026-09-30T11:30:00Z' }, now.getTime()), Date.parse('2026-09-30T12:30:00Z'));
  assert.equal(nextCustomerRefresh({ requestedAt: '2026-09-30T10:30:00Z' }, now.getTime()), 0);
});

test('counts per approved issue add up, with Other as the exact remainder and new groups flagged for agents', () => {
  const report = {
    currentCount: 100, previousCount: 80, sampled: false,
    groups: [
      { theme: 'Open barset', count: 30, previousCount: 20 },
      { theme: 'Opening breset', count: 5, previousCount: 2 },
      { theme: 'vPOS stuck', count: 20, previousCount: 25 },
      { theme: 'New printer paper', count: 6, previousCount: 0 },
      { theme: 'Tiny', count: 2, previousCount: 0 },
    ],
  };
  const { patterns, unreviewed } = liveCounts(report, approved, [0, 0, 1, -1, -1]);
  assert.deepEqual(patterns.map((p) => [p.title, p.count, p.previousCount]), [
    ['Open a barset', 35, 22], ['vPOS app freezes', 20, 25], ['Other requests', 45, 33],
  ]);
  assert.equal(patterns.reduce((s, p) => s + p.count, 0), 100);
  assert.deepEqual(unreviewed, [{ title: 'New printer paper', count: 6 }]);
});

test('a refreshed snapshot keeps the agent summary and its date, and hides agent notes from customers', () => {
  const config = liveConfigFrom({ schedule: 'daily', preset: 'last-30', approved, overview: 'Barsets are the main issue.', actions: ['Automate barsets'] }, { organization: org, now: new Date('2026-09-12T09:00:00Z') });
  const report = { startDate: '2026-09-01', endDate: '2026-09-30', currentCount: 50, previousCount: 40, timeSeries: [], groups: [] };
  const snap = snapshotFrom(refreshedSnapshotInput(config, report, { patterns: [{ title: 'Open a barset', count: 10 }], unreviewed: [{ title: 'Printer paper', count: 4 }] }, now));
  assert.equal(snap.overview, 'Barsets are the main issue.');
  assert.equal(snap.summaryWrittenAt, '2026-09-12T09:00:00.000Z');
  assert.equal(snap.refreshedAt, '2026-09-30T12:00:00.000Z');
  assert.deepEqual(snap.live, { preset: 'last-30', schedule: 'daily' });
  assert.deepEqual(snap.unreviewed, [{ title: 'Printer paper', count: 4 }]);
  const view = portalView(snap);
  assert.equal('unreviewed' in view, false);
  assert.equal('publishedBy' in view, false);
});

test('AI assignments are validated and the tool is forced; word matching is the fallback', async () => {
  assert.deepEqual(parseAssignments({ assignments: [{ index: 0, issue: 1 }, { index: 0, issue: 0 }, { index: 1, issue: 9 }, { index: 5, issue: 0 }] }, 3, 2), [1, -1, -1]);
  let prompt;
  const chatFn = async (p) => { prompt = p; return { choices: [{ message: { content: '', tool_calls: [{ function: { name: 'assign_groups', arguments: { assignments: [{ index: 0, issue: 0 }] } } }] } }] }; };
  const report = { groups: [{ theme: 'Open barset', tickets: [] }, { theme: 'Other thing', tickets: [] }] };
  const result = await assignToApproved(report, approved, { chatFn, models: ['claude-sonnet-5'] });
  assert.equal(prompt.tool_choice.function.name, 'assign_groups');
  assert.deepEqual(result.assignments, [0, -1]);
  assert.deepEqual(assignByWords([{ theme: 'Open barset' }, { theme: 'vPOS app freezing' }, { theme: 'Printer' }], approved), [0, 1, -1]);
});

test('customers see each approved issue with its trend, resolution and newest examples; Other has none', () => {
  const report = {
    startDate: '2026-09-01', endDate: '2026-09-03', currentCount: 10, previousCount: 4, sampled: false,
    timeSeries: [{ date: '2026-09-01', count: 4 }, { date: '2026-09-02', count: 3 }, { date: '2026-09-03', count: 3 }],
    bucketSamples: [4, 3, 3],
    groups: [
      { theme: 'Open barset', count: 3, previousCount: 1, sampleCount: 3, buckets: [2, 1, 0], resolvedHours: [2, 4], openCount: 1,
        tickets: [{ key: 'SD-1', summary: 'Open barset 1', status: 'Open', created: '2026-09-01T10:00:00Z', url: 'https://api.atlassian.com/x' }] },
      { theme: 'Opening breset', count: 2, previousCount: 0, sampleCount: 2, buckets: [0, 0, 2], resolvedHours: [10], openCount: 1,
        tickets: [{ key: 'SD-9', summary: 'Opening breset', status: 'Resolved', created: '2026-09-03T10:00:00Z' }] },
    ],
  };
  const { patterns } = liveCounts(report, approved, [0, 0]);
  const [barset, vpos, other] = patterns;
  assert.deepEqual(barset.trend.map((t) => t.count), [2, 1, 2]);
  assert.equal(barset.medianHours, 4);
  assert.equal(barset.openShare, 40);
  assert.deepEqual(barset.examples.map((e) => e.key), ['SD-9', 'SD-1']);
  assert.equal('url' in barset.examples[0], false);
  assert.deepEqual(vpos.examples, []);
  assert.equal(other.title, 'Other requests');
  assert.equal('examples' in other, false);
});

test('only breakdowns marked Show on portal reach customers, and detailed fields only from the app build', () => {
  const report = { breakdowns: [{ id: 'base', label: 'Base', values: [{ value: 'STN', count: 4 }] }, { id: 'queue', label: 'Support Queue', values: [{ value: 'L2', count: 4 }] }] };
  assert.deepEqual(portalBreakdowns(report, [{ id: 'base', portal: true }, { id: 'queue', portal: false }]).map((b) => b.id), ['base']);
  const input = {
    organization: org, period: { from: '2026-09-01', to: '2026-09-30' }, totals: { current: 4, previous: 2 },
    patterns: [{ title: 'Open a barset', count: 4, examples: [
      { key: 'SD-1', summary: 'Open barset', url: 'https://x.atlassian.net/servicedesk/customer/portal/3/SD-1' },
      { key: 'SD-2', summary: 'Agent view link', url: 'https://x.atlassian.net/browse/SD-2' },
      { key: 'not a key', summary: 'dropped' },
    ] }],
    breakdowns: portalBreakdowns(report, [{ id: 'base', portal: true }]),
    resolution: { medianHours: 12.34, openShare: 120 },
  };
  const fromPage = snapshotFrom(input, {});
  assert.equal(JSON.stringify(fromPage).includes('SD-1'), false);
  assert.equal('breakdowns' in fromPage, false);
  const built = snapshotFrom(input, { detailed: true });
  assert.deepEqual(built.patterns[0].examples.map((e) => [e.key, e.url]), [['SD-1', 'https://x.atlassian.net/servicedesk/customer/portal/3/SD-1'], ['SD-2', '']]);
  assert.deepEqual(built.breakdowns.map((b) => b.label), ['Base']);
  assert.deepEqual(built.resolution, { medianHours: 12.3, openShare: 100 });
});

test('portal reports keep the publishing agent\'s time zone and carry when requests arrive', () => {
  const config = liveConfigFrom({ schedule: 'weekly', preset: 'last-30', timeZone: 'Europe/Dublin', approved }, { organization: org, now });
  assert.equal(config.timeZone, 'Europe/Dublin');
  assert.equal(liveConfigFrom({ schedule: 'weekly', timeZone: 'Mars/Base' }, { organization: org, now }).timeZone, 'UTC');
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0)); grid[0][6] = 5;
  const hours = new Array(24).fill(0); hours[6] = 3;
  const report = { startDate: '2026-09-01', endDate: '2026-09-30', currentCount: 5, previousCount: 2, timeSeries: [], groups: [{ theme: 'Open barset', count: 3, previousCount: 1, hours, tickets: [] }], timeOfDay: { timeZone: 'Europe/Dublin', grid, estimated: false } };
  const counts = liveCounts(report, approved, [0]);
  assert.equal(counts.patterns[0].hours[6], 3);
  const snap = snapshotFrom(refreshedSnapshotInput(config, report, counts, now), { detailed: true });
  assert.equal(snap.timeOfDay.timeZone, 'Europe/Dublin');
  assert.equal(snap.timeOfDay.grid[0][6], 5);
  assert.equal(snap.patterns[0].hours[6], 3);
  assert.equal('timeOfDay' in snapshotFrom(refreshedSnapshotInput(config, report, counts, now)), false);
  assert.equal(snapshotFrom({ ...refreshedSnapshotInput(config, report, counts, now), timeOfDay: { grid: [[1]] } }, { detailed: true }).timeOfDay, null);
});
