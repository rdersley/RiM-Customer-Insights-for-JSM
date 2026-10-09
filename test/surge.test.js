import test from 'node:test';
import assert from 'node:assert/strict';
import { baselinePerWindow, checkSurges, copiedFields, DEFAULT_SURGE, incidentFields, isSurge, openSurgeFor, sanitizeSurge, searchWords, surgeCandidates, surgeText } from '../src/surge.js';
import { sanitizeSettings } from '../src/settings.js';

const NOW = Date.parse('2026-10-09T10:00:00Z');
const BASES = ['STN', 'DUB', 'BGY', 'MAN', 'ALC', 'KRK'];
const issue = (n, summary, base, client = { id: '501', value: 'Ryanair' }) => ({
  key: `CS-${n}`,
  dims: { cf_base: [base] },
  fields: { summary, description: '', created: new Date(NOW - n * 60000).toISOString(), status: { name: 'Open' }, cf_client: client },
});
const surgeIssues = [
  ...BASES.map((b, i) => issue(i + 1, `RYR - CREW${i} - ${b} - vPOS stuck on sync screen`, b)),
  issue(20, 'RYR - CREW9 - DUB - printer paper jam', 'DUB'),
  issue(21, 'RYR - CREW8 - STN - printer paper jam', 'STN'),
];
const config = { ...DEFAULT_SURGE, enabled: true, minTickets: 5, multiple: 3, minBases: 3, baseFieldId: 'cf_base', createIssue: true, projectKey: 'SD', issueTypeId: '10001', priorityName: 'P2', copyFields: [{ id: 'cf_client', name: 'Client', kind: 'option' }] };
const organization = { id: '188', name: 'Ryanair Crew' };

test('settings: off by default, bounded, base and copied fields checked', () => {
  const orgs = [organization];
  const fields = [{ id: 'cf_base', name: 'Base', kind: 'option' }, { id: 'cf_client', name: 'Client', kind: 'option' }, { id: 'cf_org', name: 'Organizations', kind: null }];
  const s = sanitizeSurge({ enabled: true, organizations: [{ id: '188' }, { id: '999' }], minTickets: 1, windowMinutes: 30, multiple: 50, baseFieldId: 'cf_base', copyFields: ['cf_client', 'cf_org', 'cf_client'], projectKey: 'sd', priorityName: ' P2 ' }, orgs, [{ id: 'cf_base' }], fields);
  assert.deepEqual(s.organizations, [organization]);
  assert.equal(s.minTickets, 6); // out of range: the default
  assert.equal(s.windowMinutes, 30);
  assert.equal(s.multiple, 3);
  assert.equal(s.projectKey, 'SD');
  assert.equal(s.priorityName, 'P2');
  assert.deepEqual(s.copyFields, [{ id: 'cf_client', name: 'Client', kind: 'option' }]);
  assert.equal(sanitizeSurge(undefined).enabled, false);
  assert.equal(sanitizeSettings({}, fields, orgs).surge.enabled, false);
});

test('a burst on one issue from several bases is a candidate; small or local ones are not', () => {
  const found = surgeCandidates(surgeIssues, config);
  assert.equal(found.length, 1);
  assert.equal(found[0].count, 6);
  assert.deepEqual([...found[0].bases].sort(), [...BASES].sort());
  assert.equal(surgeCandidates(surgeIssues, { ...config, minBases: 7 }).length, 0);
  assert.equal(surgeCandidates(surgeIssues, { ...config, minTickets: 7 }).length, 0);
  assert.match(searchWords(found[0].theme), /vpos|stuck|sync/);
});

test('normal rate: a week of tickets scaled to the window, at least 1', () => {
  assert.equal(baselinePerWindow(168, 60), 1);
  assert.equal(isSurge(6, 0.2, 3), true);
  assert.equal(isSurge(6, 2.5, 3), false);
  assert.equal(surgeText({ count: 8, windowMinutes: 60, baseline: 0.4, bases: [1, 2, 3] }), '8 tickets in the last 60 minutes (normally fewer than 1), from 3 bases');
});

test('the incident ticket copies the client field and is never shared with the organisation', () => {
  const [candidate] = surgeCandidates(surgeIssues, config);
  const copied = copiedFields(surgeIssues, candidate.keys, config.copyFields);
  assert.deepEqual(copied, { cf_client: { id: '501' } });
  const fields = incidentFields({ ...candidate, baseline: 0.2, windowMinutes: 60, organization }, config, copied, 'https://example.atlassian.net');
  assert.deepEqual(fields.priority, { name: 'P2' });
  assert.deepEqual(fields.project, { key: 'SD' });
  assert.deepEqual(fields.labels, ['customer-insights-surge']);
  assert.match(fields.summary, /^Possible incident: .* \(Ryanair Crew, 6 tickets in 60 min\)$/);
  assert.ok(!Object.keys(fields).some((k) => /organi[sz]ation/i.test(k)));
});

function fakes({ before = 7 } = {}) {
  const calls = { created: [], links: [], comments: [], counts: [] };
  const alerts = new Map();
  let state = {};
  const jira = {
    siteUrl: 'https://example.atlassian.net',
    search: async () => fakes.issues,
    count: async (jql) => { calls.counts.push(jql); return before; },
    createIssue: async (fields) => { calls.created.push(fields); return 'SD-900'; },
    link: async (key, keys) => { calls.links.push([key, keys]); return keys.length; },
    comment: async (key, body) => { calls.comments.push([key, body]); },
  };
  const store = {
    loadSurgeState: async () => state,
    saveSurgeState: async (_, s) => { state = s; },
    saveAlert: async (a) => { alerts.set(a.id, a); },
    updateAlert: async (id, change) => { alerts.set(id, { ...alerts.get(id), ...change }); },
  };
  return { jira, store, calls, alerts };
}

test('a surge raises one incident; later tickets are linked to it with a comment', async () => {
  const f = fakes();
  fakes.issues = surgeIssues;
  const settings = { surge: config, breakdowns: [{ id: 'cf_base', kind: 'option' }], synonyms: [] };
  const first = await checkSurges(organization, settings, { jira: f.jira, store: f.store, now: NOW });
  assert.equal(first.results.length, 1);
  assert.equal(f.calls.created.length, 1);
  assert.equal(f.calls.links[0][1].length, 6);
  assert.match(f.calls.counts[0], /^organizations = "Ryanair Crew" AND text ~ ".+" AND created >= "-7d" AND created < "-60m"$/);
  const [alert] = [...f.alerts.values()];
  assert.equal(alert.kind, 'surge');
  assert.equal(alert.issueKey, 'SD-900');

  // Five minutes later, the same tickets: nothing new.
  await checkSurges(organization, settings, { jira: f.jira, store: f.store, now: NOW + 300000 });
  assert.equal(f.calls.created.length, 1);
  assert.equal(f.calls.comments.length, 0);

  // Two more tickets on the same issue: linked and commented, not a new incident.
  fakes.issues = [...surgeIssues, issue(30, 'RYR - CREW30 - VIE - vPOS stuck on sync screen', 'VIE'), issue(31, 'RYR - CREW31 - MLA - vPOS stuck on sync screen', 'MLA')];
  await checkSurges(organization, settings, { jira: f.jira, store: f.store, now: NOW + 600000 });
  assert.equal(f.calls.created.length, 1);
  assert.deepEqual(f.calls.links[1], ['SD-900', ['CS-30', 'CS-31']]);
  assert.equal(f.calls.comments.length, 1);
  assert.equal(f.alerts.get(alert.id).count, 8);
  assert.equal(f.alerts.get(alert.id).surge.bases, 8);
});

test('an issue that is always this busy is not a surge', async () => {
  const f = fakes({ before: 7 * 24 * 3 }); // 3 an hour, every hour, for a week
  fakes.issues = surgeIssues;
  const out = await checkSurges(organization, { surge: config, breakdowns: [], synonyms: [] }, { jira: f.jira, store: f.store, now: NOW });
  assert.deepEqual(out.results, []);
  assert.equal(f.calls.created.length, 0);
  assert.equal(openSurgeFor({ theme: 'x', keys: ['A-1'] }, [{ theme: 'y', keys: ['A-1'], updatedAt: new Date(NOW - 7 * 3600000).toISOString() }], NOW), null);
});
