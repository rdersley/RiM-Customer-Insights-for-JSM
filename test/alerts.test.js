import test from 'node:test';
import assert from 'node:assert/strict';
import { alertWindow, asOf, changeText, checkOrganisation, findSpikes, isCheckDue, issueFields } from '../src/alerts.js';

const now = Date.parse('2026-10-01T09:00:00Z');
const group = (theme, count, previousCount, extra = {}) => ({ theme, count, previousCount, tickets: [{ key: `SD-${count}`, summary: `${theme} example` }], keys: [`SD-${count}`], ...extra });

test('the window is the last 7 whole days, ending yesterday', () => {
  assert.deepEqual(alertWindow(now), { from: '2026-09-24', to: '2026-09-30' });
});

test('a check is due about once a day', () => {
  assert.equal(isCheckDue({}, now), true);
  assert.equal(isCheckDue({ checkedAt: '2026-10-01T01:00:00Z' }, now), false);
  assert.equal(isCheckDue({ checkedAt: '2026-09-30T09:00:00Z' }, now), true);
});

test('spikes: big enough, up by the threshold or new, and not alerted in the last week', () => {
  const report = { groups: [
    group('Vpos stuck', 22, 10), // +120%
    group('Pin pad pairing', 12, 10), // +20%: below threshold
    group('Printer', 4, 0), // new, but under the minimum
    group('Barset open', 6, 0), // new
    group('Sync errors', 30, 10), // +200% but alerted 3 days ago
    group('Login', 15, 10), // +50% exactly
  ] };
  const seen = { 'sync errors': '2026-09-28T09:00:00Z', login: '2026-09-20T09:00:00Z' };
  const spikes = findSpikes(report, { thresholdPercent: 50, minTickets: 5 }, seen, now);
  assert.deepEqual(spikes.map((s) => [s.theme, s.changePercent]), [['Vpos stuck', 120], ['Barset open', null], ['Login', 50]]);
  assert.equal(changeText(spikes[0]), 'up 120% (22 vs 10 the week before)');
  assert.equal(changeText(spikes[1]), 'new: 6 tickets, none the week before');
  assert.equal(changeText({ ...spikes[0], estimated: true }), 'up 120% (≈22 vs ≈10 the week before)');
});

test('the alert ticket links the examples and a search on the site', () => {
  const alert = {
    ...findSpikes({ groups: [group('Vpos stuck', 22, 10)] }, { thresholdPercent: 50, minTickets: 5 }, {}, now)[0],
    organization: { id: '7', name: 'Ryanair Crew' },
    window: { from: '2026-09-24', to: '2026-09-30' },
  };
  const fields = issueFields(alert, { projectKey: 'SD', issueTypeId: '10001' }, 'https://x.atlassian.net');
  assert.deepEqual(fields.project, { key: 'SD' });
  assert.deepEqual(fields.issuetype, { id: '10001' });
  assert.equal(fields.summary, 'Spike: Vpos stuck for Ryanair Crew (up 120% (22 vs 10 the week before))');
  assert.deepEqual(fields.labels, ['customer-insights-spike']);
  const json = JSON.stringify(fields.description);
  assert.match(json, /https:\/\/x\.atlassian\.net\/browse\/SD-22/);
  assert.match(json, /issues\/\?jql=key%20in%20\(SD-22\)/);
  assert.doesNotMatch(JSON.stringify(issueFields(alert, { projectKey: 'SD', issueTypeId: '1' }, '').description), /href/);
});

test('organisations that are not watched, or alerts switched off, are skipped', async () => {
  const store = (alerts) => ({ loadSettings: async () => ({ alerts }) });
  assert.deepEqual(await checkOrganisation('7', store({ enabled: false, organizations: [{ id: '7', name: 'A' }] }), now), { skipped: 'not watched' });
  assert.deepEqual(await checkOrganisation('8', store({ enabled: true, organizations: [{ id: '7', name: 'A' }] }), now), { skipped: 'not watched' });
});

test('ALERTS_AS_OF moves the window for testing; anything else is ignored', () => {
  assert.deepEqual(alertWindow(asOf(now, '2026-09-10')), { from: '2026-09-03', to: '2026-09-09' });
  assert.equal(asOf(now, ''), now);
  assert.equal(asOf(now, 'yesterday'), now);
  assert.equal(asOf(now, undefined), now);
});
