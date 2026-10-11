import test from 'node:test';
import assert from 'node:assert/strict';
import { addTallies, slaFieldChoices, slaFieldList, slaHotspots, slaState, slaSummary, slaTally } from '../src/sla.js';
import { buildReport } from '../src/analysis.js';
import { sanitizeSettings } from '../src/settings.js';

const TTR = 'customfield_500';
const met = { completedCycles: [{ breached: false }] };
const breached = { completedCycles: [{ breached: false }, { breached: true }] };
const running = { ongoingCycle: { breached: true } };

test('SLA state from JSM SLA fields', () => {
  assert.equal(slaState(met), 'met');
  assert.equal(slaState(breached), 'breached');
  assert.equal(slaState(running), 'breached');
  assert.equal(slaState({ ongoingCycle: { breached: false } }), 'met');
  assert.equal(slaState({ completedCycles: [] }), null);
  assert.equal(slaState(null), null);
  assert.equal(slaState('breached'), 'breached'); // already reduced (full analysis)
  assert.deepEqual(addTallies({ a: { met: 1, breached: 2 } }, { a: { met: 3, breached: 0 }, b: { met: 1, breached: 1 } }), { a: { met: 4, breached: 2 }, b: { met: 1, breached: 1 } });
});

const issue = (key, summary, team, sla) => ({ key, dims: { team: [team] }, fields: { summary, description: '', created: '2026-09-10T10:00:00Z', status: { name: 'Done' }, [TTR]: sla } });

test('reports count SLAs for the period, each issue and each breakdown value', () => {
  const issues = [
    issue('IT-1', 'VPN not connecting', 'Network', breached),
    issue('IT-2', 'VPN not connecting from home', 'Network', breached),
    issue('IT-3', 'VPN not connecting again', 'Network', met),
    issue('IT-4', 'Printer jammed on floor 2', 'Desk', met),
    issue('IT-5', 'Printer jammed again', 'Desk', met),
    issue('IT-6', 'Printer jammed paper', 'Desk', null),
  ];
  const slaFields = [{ id: TTR, name: 'Time to resolution' }];
  const report = buildReport(issues, '2026-09-01', '2026-09-30', null, { slaFields, breakdowns: [{ id: 'team', label: 'Team' }] });
  assert.deepEqual(report.sla, [{ id: TTR, name: 'Time to resolution', met: 3, breached: 2, breachedShare: 40, estimated: false }]);
  const vpn = report.groups.find((g) => /vpn/i.test(g.theme));
  assert.deepEqual(vpn.sla[TTR], { met: 1, breached: 2 });
  const hot = slaHotspots(report, report.groups, TTR);
  assert.equal(report.groups[hot.issues[0].index], vpn);
  assert.equal(hot.issues[0].share, 67);
  assert.deepEqual(hot.breakdowns[0].values.map((v) => [v.value, v.share]), [['Network', 67]]); // Desk has only 2 with the SLA
  // Without SLA fields, nothing is added.
  assert.deepEqual(buildReport(issues, '2026-09-01', '2026-09-30', null, {}).sla, []);
  assert.deepEqual(slaSummary(issues, slaFields, 2)[0].met, 6);
  assert.deepEqual(slaTally([issue('X-1', 'a', 'b', running)], slaFields), { [TTR]: { met: 0, breached: 1 } });
});

test('SLA fields: only the site\'s JSM SLA fields, up to 3', () => {
  const fields = [
    { id: 'customfield_500', name: 'Time to resolution', schema: { custom: 'com.atlassian.servicedesk:sd-sla-field' } },
    { id: 'customfield_501', name: 'Time to first response', schema: { custom: 'com.atlassian.servicedesk:sd-sla-field' } },
    { id: 'customfield_9', name: 'Client', schema: { custom: 'com.atlassian.jira.plugin.system.customfieldtypes:select' } },
  ];
  const choices = slaFieldChoices(fields);
  assert.deepEqual(choices.map((c) => c.name), ['Time to first response', 'Time to resolution']);
  assert.deepEqual(slaFieldList(['customfield_500', 'customfield_9', 'customfield_500'], choices), [{ id: 'customfield_500', name: 'Time to resolution' }]);
  assert.deepEqual(sanitizeSettings({ slaFields: ['customfield_501'] }, [], [], { slaChoices: choices }).slaFields, [{ id: 'customfield_501', name: 'Time to first response' }]);
  assert.deepEqual(sanitizeSettings({ slaFields: ['customfield_501'] }, []).slaFields, []);
});
