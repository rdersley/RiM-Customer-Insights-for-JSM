import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PLACEHOLDERS, DEFAULT_SYNONYMS, synonymList, sanitizeAlerts, dimensionsOf, fieldKind, jqlClause, jqlEmptyClause, placeholderList, readValues, sanitizeSettings, selectableFields } from '../src/settings.js';

// Shapes as returned by GET /rest/api/3/field.
const fields = [
  { id: 'customfield_10100', name: 'Base', schema: { type: 'option', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:select' } },
  { id: 'customfield_10101', name: 'Device type', schema: { type: 'array', items: 'option', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:multiselect' } },
  { id: 'customfield_10102', name: 'Region / Base', schema: { type: 'option-with-child', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:cascadingselect' } },
  { id: 'customfield_10010', name: 'Request Type', schema: { type: 'sd-customerrequesttype', custom: 'com.atlassian.servicedesk:vp-origin' } },
  { id: 'labels', name: 'Labels', schema: { type: 'array', items: 'string', system: 'labels' } },
  { id: 'components', name: 'Components', schema: { type: 'array', items: 'component', system: 'components' } },
  { id: 'priority', name: 'Priority', schema: { type: 'priority', system: 'priority' } },
  { id: 'customfield_10200', name: 'Notes', schema: { type: 'string', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:textarea' } },
  { id: 'customfield_10201', name: 'Cost', schema: { type: 'number' } },
  { id: 'assignee', name: 'Assignee', schema: { type: 'user' } },
];

test('only fields that can be broken down are offered', () => {
  const offered = selectableFields(fields);
  assert.deepEqual(offered.map((f) => f.name), ['Base', 'Components', 'Device type', 'Labels', 'Priority', 'Region / Base', 'Request Type']);
  assert.equal(fieldKind(fields[7]), null);
  assert.equal(fieldKind(fields[9]), null);
});

test('values are read for each field kind', () => {
  assert.deepEqual(readValues({ value: 'STN' }, 'option'), ['STN']);
  assert.deepEqual(readValues([{ value: 'vPOS' }, { value: 'Pin pad' }], 'options'), ['vPOS', 'Pin pad']);
  assert.deepEqual(readValues({ value: 'UK', child: { value: 'STN' } }, 'cascading'), ['UK / STN']);
  assert.deepEqual(readValues({ requestType: { name: 'Report a fault' } }, 'requestType'), ['Report a fault']);
  assert.deepEqual(readValues(['urgent', 'crew'], 'strings'), ['urgent', 'crew']);
  assert.deepEqual(readValues([{ name: 'Backend' }], 'named'), ['Backend']);
  assert.deepEqual(readValues({ name: 'High' }, 'named'), ['High']);
  assert.deepEqual(readValues(null, 'option'), []);
});

test('settings are validated against the site fields: known ids only, no repeats', () => {
  const selectable = selectableFields(fields);
  const saved = sanitizeSettings({
    breakdowns: [
      { id: 'customfield_10100', label: ' Base location ' },
      { id: 'customfield_10100', label: 'duplicate' },
      { id: 'customfield_10200', label: 'text field' },
      { id: 'customfield_99999', label: 'missing' },
      { id: 'customfield_10101', label: '' },
      { id: 'labels' },
      { id: 'priority' },
    ],
    portalEnabled: false,
  }, selectable);
  assert.deepEqual(saved.breakdowns.map((b) => [b.id, b.label, b.kind]), [
    ['customfield_10100', 'Base location', 'option'],
    ['customfield_10101', 'Device type', 'options'],
    ['labels', 'Labels', 'strings'],
    ['priority', 'Priority', 'named'],
  ]);
  assert.equal(saved.portalEnabled, false);
  assert.equal(sanitizeSettings({}, selectable).portalEnabled, false); // opt-in per site
  assert.equal(sanitizeSettings({ portalEnabled: true }, selectable).portalEnabled, true);
});

test('up to 5 breakdown fields, and a bounded pattern minimum defaulting to 3', () => {
  const selectable = selectableFields(fields);
  const all = sanitizeSettings({ breakdowns: selectable.map((f) => ({ id: f.id })) }, selectable);
  assert.equal(all.breakdowns.length, 5);
  assert.equal(all.minPatternSize, 3);
  assert.equal(sanitizeSettings({ minPatternSize: 4 }, selectable).minPatternSize, 4);
  assert.equal(sanitizeSettings({ minPatternSize: '6' }, selectable).minPatternSize, 6);
  for (const bad of [1, 11, 2.5, 'x', null]) assert.equal(sanitizeSettings({ minPatternSize: bad }, selectable).minPatternSize, 3);
});

test('a breakdown value becomes a JQL condition for drill-down and Jira links', () => {
  const kinds = Object.fromEntries(selectableFields(fields).map((f) => [f.id, f]));
  assert.equal(jqlClause(kinds.customfield_10100, 'STN'), 'cf[10100] = "STN"');
  assert.equal(jqlClause(kinds.customfield_10101, 'vPOS "gen 3"'), 'cf[10101] = "vPOS \\"gen 3\\""');
  assert.equal(jqlClause(kinds.customfield_10102, 'UK / STN'), 'cf[10102] in cascadeOption("UK", "STN")');
  assert.equal(jqlClause(kinds.customfield_10102, 'UK'), 'cf[10102] in cascadeOption("UK")');
  assert.equal(jqlClause(kinds.labels, 'urgent'), 'labels = "urgent"');
  assert.equal(jqlClause(kinds.components, 'Backend'), 'component = "Backend"');
  assert.equal(jqlClause(kinds.priority, 'High'), 'priority = "High"');
  assert.equal(jqlClause(kinds.customfield_10010, 'Report a fault'), null);
  assert.equal(jqlClause(kinds.customfield_10100, ''), null);
});

test('an issue is reduced to its breakdown values', () => {
  const breakdowns = sanitizeSettings({ breakdowns: [{ id: 'customfield_10100' }, { id: 'customfield_10101' }] }, selectableFields(fields)).breakdowns;
  const issue = { fields: { customfield_10100: { value: 'STN' }, customfield_10101: [{ value: 'vPOS' }, { value: 'vPOS' }] } };
  assert.deepEqual(dimensionsOf(issue, breakdowns), { customfield_10100: ['STN'], customfield_10101: ['vPOS'] });
  assert.deepEqual(dimensionsOf({ fields: {} }, breakdowns), {});
});

test('placeholder values: defaults, text lists, no repeats, bounded', () => {
  assert.deepEqual(placeholderList(undefined), DEFAULT_PLACEHOLDERS);
  assert.deepEqual(placeholderList('Unknown, please update\n\nunknown ,  N/A '), ['Unknown', 'please update', 'N/A']);
  assert.deepEqual(placeholderList([]), []);
  assert.equal(placeholderList(Array.from({ length: 50 }, (_, i) => `v${i}`)).length, 30);
  assert.deepEqual(sanitizeSettings({ placeholders: 'TBC' }, []).placeholders, ['TBC']);
  assert.deepEqual(sanitizeSettings({}, []).placeholders, DEFAULT_PLACEHOLDERS);
});

test('an empty breakdown field becomes an is EMPTY condition', () => {
  assert.equal(jqlEmptyClause({ id: 'customfield_10100', kind: 'option' }), 'cf[10100] is EMPTY');
  assert.equal(jqlEmptyClause({ id: 'labels', kind: 'strings' }), 'labels is EMPTY');
  assert.equal(jqlEmptyClause({ id: 'customfield_10010', kind: 'requestType' }), null);
});

test('alert settings: off by default, watched organisations from the visible list only, bounded numbers', () => {
  const visible = [{ id: '7', name: 'Ryanair Crew' }, { id: '8', name: 'Aer Lingus' }];
  assert.equal(sanitizeSettings({}, []).alerts.enabled, false);
  assert.equal(sanitizeSettings({}, []).alerts.createIssue, false);
  const alerts = sanitizeAlerts({
    enabled: true,
    organizations: [{ id: '7', name: 'Renamed by the page' }, '8', { id: '7' }, { id: '99', name: 'Not visible' }],
    thresholdPercent: '75', minTickets: 1, createIssue: true, projectKey: ' sd ', issueTypeName: '  Problem ', issueTypeId: 'abc',
  }, visible);
  assert.deepEqual(alerts.organizations, visible);
  assert.equal(alerts.thresholdPercent, 75);
  assert.equal(alerts.minTickets, 5);
  assert.equal(alerts.projectKey, 'SD');
  assert.equal(alerts.issueTypeName, 'Problem');
  assert.equal(alerts.issueTypeId, '');
  assert.equal(sanitizeAlerts({ enabled: 'yes', projectKey: 'not a key!' }, visible).enabled, false);
  assert.equal(sanitizeAlerts({ projectKey: 'not a key!' }, visible).projectKey, '');
  const many = Array.from({ length: 40 }, (_, i) => ({ id: String(i), name: `Org ${i}` }));
  assert.equal(sanitizeAlerts({ organizations: many }, many).organizations.length, 25);
});

test('an Organisation breakdown comes from the site field, limited to the selected organisations', async () => {
  const { organisationBreakdown } = await import('../src/settings.js');
  const siteFields = [{ id: 'customfield_10002', name: 'Organizations', schema: { type: 'array', items: 'sd-customerorganization', custom: 'com.atlassian.servicedesk:sd-customer-organizations' } }];
  const b = organisationBreakdown(siteFields, ['Ryanair Crew', 'Aer Lingus']);
  assert.deepEqual({ id: b.id, kind: b.kind, portal: b.portal }, { id: 'customfield_10002', kind: 'organizations', portal: false });
  assert.equal(organisationBreakdown([], ['A']), null);
  const issue = { fields: { customfield_10002: [{ id: 1, name: 'Ryanair Crew' }, { id: 3, name: 'Some Other Org' }] } };
  assert.deepEqual(dimensionsOf(issue, [b]), { customfield_10002: ['Ryanair Crew'] });
  assert.equal(jqlClause(b, 'Aer "Lingus"'), 'organizations = "Aer \\"Lingus\\""');
  assert.equal(jqlEmptyClause(b), null);
});

test('same-meaning lists parse from text, drop repeats and need two words', () => {
  assert.deepEqual(synonymList(undefined), DEFAULT_SYNONYMS);
  assert.deepEqual(synonymList('pinpad = bluepad, pin  pad\n\nlonely\nBluepad, card reader, terminal'), [['pinpad', 'bluepad', 'pin pad'], ['card reader', 'terminal']]);
  assert.deepEqual(synonymList([['a1', 'b1'], 'c1: d1']), [['a1', 'b1'], ['c1', 'd1']]);
  assert.equal(synonymList(Array.from({ length: 60 }, (_, i) => `w${i}, v${i}`)).length, 40);
  assert.deepEqual(sanitizeSettings({ synonyms: '' }, []).synonyms, []);
});
