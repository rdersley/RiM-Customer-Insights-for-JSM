import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DEVICES, deviceIdChoices, deviceImpact, deviceOf, devicesAffected, fleetFromCrew, impactText, sanitizeDevices, suggestPriority } from '../src/devices.js';
import { buildReport } from '../src/analysis.js';
import { checkSurges, DEFAULT_SURGE } from '../src/surge.js';

const config = { ...DEFAULT_DEVICES, idFieldId: 'customfield_10', typeFieldId: 'customfield_11' };
const ticket = (key, summary, deviceId, type, created = '2026-10-13T08:00:00Z') => ({
  key, fields: { summary, description: '', created, status: { name: 'Open' }, customfield_10: deviceId, customfield_11: type ? { value: type } : null },
});

test('settings: fields checked, types cleaned, thresholds in order', () => {
  const s = sanitizeDevices({ idFieldId: 'customfield_10', typeFieldId: 'customfield_11', types: [{ label: 'vPOS', perCrew: '1', values: 'vPos, VPOS device' }, { label: '', values: 'x' }], p1Percent: 5, p2Percent: 20 },
    { idChoices: [{ id: 'customfield_10' }], selectable: [{ id: 'customfield_11' }] });
  assert.equal(s.idFieldId, 'customfield_10');
  assert.equal(s.typeFieldId, 'customfield_11');
  assert.deepEqual(s.types, [{ label: 'vPOS', perCrew: 1, values: ['vpos', 'vpos device'] }]);
  assert.deepEqual([s.p1Percent, s.p2Percent], [20, 5]);
  assert.equal(sanitizeDevices({ idFieldId: 'customfield_99' }).idFieldId, '');
  assert.deepEqual(deviceIdChoices([
    { id: 'customfield_10', name: 'Device serial', schema: { type: 'string' } },
    { id: 'customfield_12', name: 'Due', schema: { type: 'date' } },
    { id: 'summary', name: 'Summary', schema: { type: 'string' } },
  ]).map((f) => f.name), ['Device serial']);
});

test('devices from tickets: distinct IDs by type, several IDs in one field', () => {
  assert.deepEqual(deviceOf(ticket('A-1', 'x', ' vp-001 , VP-002', 'vPos Device'), config), { ids: ['VP-001', 'VP-002'], type: 'vPOS' });
  assert.deepEqual(deviceOf(ticket('A-2', 'x', 'BP 9', 'Bluepad'), config).type, 'Card reader');
  const issues = [
    ticket('A-1', 'sync', 'VP-001', 'vPos Device'),
    ticket('A-2', 'sync', 'vp-001', 'vPos Device'), // same device again
    ticket('A-3', 'sync', 'VP-002', 'vPos Device'),
    ticket('A-4', 'pinpad', 'BP-1', 'Bluepad'),
    ticket('A-5', 'no device', '', 'vPos Device'),
  ];
  assert.deepEqual(devicesAffected(issues, config), { any: 3, byType: { vPOS: 2, 'Card reader': 1 }, peak: { vPOS: 2, 'Card reader': 1 } });
  assert.deepEqual(devicesAffected(issues, { ...config, idFieldId: '' }), { any: 0, byType: {}, peak: {} });
});

test('share of the fleet from crew numbers, and the suggested priority', () => {
  const fleet = fleetFromCrew(1000, config);
  assert.deepEqual(fleet, { vPOS: 1000, 'Card reader': 1000 });
  const impact = deviceImpact({ any: 260, byType: { vPOS: 250, 'Card reader': 10 } }, fleet, config);
  assert.deepEqual(impact.map((i) => [i.label, i.share, i.suggested]), [['vPOS', 25, 'P1'], ['Card reader', 1, null]]);
  assert.equal(suggestPriority(5, config), 'P2');
  assert.equal(suggestPriority(null, config), null);
  assert.equal(impactText(impact), '250 of 1,000 vPOS (25%), 10 of 1,000 Card reader (1%)');
  assert.deepEqual(deviceImpact({ byType: { vPOS: 3 } }, {}, config)[0], { label: 'vPOS', devices: 3, fleet: null, share: null, suggested: null });
});

test('reports count devices per recurring issue', () => {
  const issues = ['VP-1', 'VP-2', 'VP-3'].map((id, i) => ticket(`S-${i}`, 'vPOS sync failing at base', id, 'vPos Device', `2026-10-0${i + 2}T08:00:00Z`));
  const report = buildReport(issues, '2026-10-01', '2026-10-10', null, { devices: config });
  assert.deepEqual(report.devices, { any: 3, byType: { vPOS: 3 }, peak: { vPOS: 1 } }); // one a day
  assert.deepEqual(report.groups[0].devices.byType, { vPOS: 3 });
  assert.equal(report.deviceConfig.p1Percent, 20);
  assert.equal(buildReport(issues, '2026-10-01', '2026-10-10', null, {}).devices, null);
});

test('a live surge reports devices affected and a suggested priority', async () => {
  const now = Date.parse('2026-10-13T10:00:00Z');
  const issues = Array.from({ length: 6 }, (_, i) => ticket(`CS-${i}`, `RYR - CREW${i} - vPOS stuck on sync screen`, `VP-${i}`, 'vPos Device', new Date(now - i * 60000).toISOString()));
  let saved;
  const settings = {
    surge: { ...DEFAULT_SURGE, enabled: true, minTickets: 5, multiple: 2 },
    breakdowns: [],
    synonyms: [],
    devices: config,
    headcounts: [{ organizations: [{ id: '188', name: 'Ryanair Crew' }], fieldId: 'b', values: [{ value: 'STN', count: 20 }] }],
  };
  const jira = { search: async () => issues, count: async () => 0, siteUrl: '' };
  const store = { loadSurgeState: async () => ({}), saveSurgeState: async () => {}, saveAlert: async (a) => { saved = a; } };
  await checkSurges({ id: '188', name: 'Ryanair Crew' }, settings, { jira, store, now });
  // 6 of 20 vPOS = 30% -> P1.
  assert.deepEqual(saved.surge.devices[0], { label: 'vPOS', devices: 6, fleet: 20, share: 30, suggested: 'P1' });
  assert.equal(saved.surge.suggested, 'P1');
});
