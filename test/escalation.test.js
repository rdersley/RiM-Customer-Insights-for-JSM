import test from 'node:test';
import assert from 'node:assert/strict';
import { escalationOf, escalationSummary, levelOf, sanitizeEscalation } from '../src/escalation.js';
import { analysisConfig, sanitizeSettings } from '../src/settings.js';

const statusById = new Map([
  ['1', { name: 'Waiting for support' }],
  ['2', { name: 'In Progress 1st Level' }],
  ['3', { name: 'Assigned to 2nd Line' }],
  ['4', { name: 'Third line investigation' }],
  ['5', { name: 'Resolved' }],
]);
const at = (h) => Date.parse('2026-10-01T09:00:00Z') + h * 3600000;
const ticket = (id, status = '5') => ({ id, fields: { created: new Date(at(0)).toISOString(), status: { id: status } } });
const move = (h, from, to) => ({ id: `${h}-${to}`, created: at(h), items: [{ fieldId: 'status', from, to }] }); // epoch ms, like Jira

test('levels from status names, or from the admin lists', () => {
  assert.equal(levelOf('In Progress 1st Level'), 1);
  assert.equal(levelOf('Assigned to 2nd Line'), 2);
  assert.equal(levelOf('Third line investigation'), 3);
  assert.equal(levelOf('Waiting for support'), 0);
  const lists = [['Waiting for support'], ['Assigned to 2nd Line'], []];
  assert.equal(levelOf('waiting for support', lists), 1);
  assert.equal(levelOf('In Progress 1st Level', lists), 0); // lists set: only listed statuses count
  assert.deepEqual(sanitizeEscalation({ enabled: true, levels: ['A\nB, A', '', 'C'] }), { enabled: true, levels: [['A', 'B'], [], ['C']] });
});

test('highest level reached and time to reach each level', () => {
  const t = escalationOf(ticket('1'), [move(3, '3', '5'), move(1, '1', '2'), move(2, '2', '3')], statusById);
  assert.equal(t.highest, 2);
  assert.deepEqual(t.reached, { 1: 3600000, 2: 7200000 });
  // No history: the current status from creation.
  assert.deepEqual(escalationOf(ticket('2', '2'), [], statusById), { highest: 1, reached: { 1: 0 } });
  const third = escalationOf(ticket('3'), [move(1, '1', '2'), move(4, '2', '4'), move(5, '4', '5')], statusById);
  assert.deepEqual([third.highest, third.reached[3]], [3, 4 * 3600000]);
});

test('summary: shares per highest level, time to 2nd level for everyone who got there', () => {
  const results = [
    { highest: 1, reached: { 1: 0 } },
    { highest: 1, reached: { 1: 0 } },
    { highest: 2, reached: { 1: 0, 2: 2 * 3600000 } },
    { highest: 3, reached: { 1: 0, 2: 4 * 3600000, 3: 10 * 3600000 } },
    { highest: 0, reached: {} },
  ];
  const s = escalationSummary(results);
  assert.equal(s.total, 5);
  assert.deepEqual(s.byLevel.map((l) => [l.level, l.tickets, l.share]), [[0, 1, 20], [1, 2, 40], [2, 1, 20], [3, 1, 20]]);
  const two = s.reach.find((r) => r.level === 2);
  assert.deepEqual([two.tickets, two.share, two.medianHours, two.averageHours, two.p90Hours], [2, 40, 3, 3, 4]);
});

test('escalation is set per project settings and only reaches analyses using them', () => {
  const settings = sanitizeSettings({ projectProfiles: [{ id: 'p-sd', name: 'SD', projects: ['SD'], escalation: { enabled: true } }, { id: 'p-it', name: 'IT', projects: ['IT'] }] }, []);
  assert.equal(analysisConfig(settings, { scope: 'internal', projects: ['SD'] }).escalation.enabled, true);
  assert.equal(analysisConfig(settings, { scope: 'internal', projects: ['IT'] }).escalation, null);
  assert.equal(analysisConfig(settings, { scope: 'internal', projects: ['SD', 'IT'] }).escalation, undefined);
});
