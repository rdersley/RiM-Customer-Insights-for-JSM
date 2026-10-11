import test from 'node:test';
import assert from 'node:assert/strict';
import { allClientFields, analysisConfig, DEFAULT_INTERNAL_SYNONYMS, sanitizeSettings } from '../src/settings.js';

const selectable = [
  { id: 'customfield_1', name: 'Client', kind: 'option' },
  { id: 'customfield_2', name: 'SD Client', kind: 'option' },
  { id: 'customfield_3', name: 'Team', kind: 'option' },
  { id: 'components', name: 'Components', kind: 'named' },
];
const slaChoices = [{ id: 'customfield_500', name: 'Time to resolution' }];

const settings = sanitizeSettings({
  breakdowns: [{ id: 'customfield_3', label: 'Team (customers)' }],
  internalBreakdowns: [{ id: 'components', label: 'Component' }],
  clientFields: ['customfield_1'],
  projectProfiles: [
    { id: 'p-sd', name: 'Service Desk', projects: ['sd', 'HW'], clientFields: ['customfield_2'], breakdowns: [{ id: 'customfield_3', label: 'Team' }], slaFields: ['customfield_500'], patterns: { minPatternSize: 2, synonyms: 'pinpad = bluepad' } },
    { id: 'p-it', name: 'IT Help', projects: ['IT', 'SD'], breakdowns: [] }, // SD already taken
    { name: 'No projects', projects: [] },
  ],
}, selectable, [], { slaChoices });

test('project settings: validated, a project in one set only, empty sets dropped', () => {
  assert.deepEqual(settings.projectProfiles.map((p) => [p.id, p.name, p.projects]), [['p-sd', 'Service Desk', ['SD', 'HW']], ['p-it', 'IT Help', ['IT']]]);
  const sd = settings.projectProfiles[0];
  assert.deepEqual(sd.clientFields.map((f) => f.name), ['SD Client']);
  assert.deepEqual(sd.slaFields.map((f) => f.name), ['Time to resolution']);
  assert.equal(sd.breakdowns[0].label, 'Team');
  assert.equal(sd.patterns.minPatternSize, 2);
  // Not set: the IT defaults.
  assert.deepEqual(settings.projectProfiles[1].patterns.synonyms, DEFAULT_INTERNAL_SYNONYMS);
});

test('an analysis uses the project settings its projects share, else the default', () => {
  const sd = analysisConfig(settings, { scope: 'internal', projects: ['SD', 'hw'] });
  assert.deepEqual(sd.profile, { id: 'p-sd', name: 'Service Desk' });
  assert.deepEqual(sd.breakdowns.map((b) => b.label), ['Team']);
  assert.deepEqual(sd.patterns.synonyms, [['pinpad', 'bluepad']]);
  assert.equal(sd.slaFields.length, 1);

  const mixed = analysisConfig(settings, { scope: 'internal', projects: ['SD', 'IT'] });
  assert.equal(mixed.profile, null);
  assert.equal(mixed.mixed, true);
  assert.deepEqual(mixed.breakdowns.map((b) => b.label), ['Component']);

  const other = analysisConfig(settings, { scope: 'internal', projects: ['OPS'] });
  assert.equal(other.profile, null);
  assert.equal(other.mixed, false);
  assert.equal(analysisConfig(settings, { scope: 'internal', projects: [], clients: ['Ryanair'] }).profile, null);
  // A project with its own settings mixed with one without: the default.
  assert.equal(analysisConfig(settings, { scope: 'internal', projects: ['SD', 'OPS'] }).profile, null);

  const customers = analysisConfig(settings, { organization: { id: '1', name: 'X' } });
  assert.deepEqual(customers.breakdowns.map((b) => b.label), ['Team (customers)']);
  assert.equal(customers.profile, null);
});

test('clients are matched in every client field, whichever settings apply', () => {
  assert.deepEqual(allClientFields(settings).map((f) => f.name), ['Client', 'SD Client']);
});
