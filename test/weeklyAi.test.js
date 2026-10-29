import test from 'node:test';
import assert from 'node:assert/strict';
import { carriedActions, notesAfterBuild, parseWeeklyNotes, suggestWeeklyNotes, weeklyAiInput } from '../src/weeklyAi.js';
import { examplesOf } from '../src/weeklyJobs.js';
import { sanitizeNotes, weeklyReport, weekOf } from '../src/weekly.js';

const week = weekOf('2026-10-19');
const config = { id: 'w-ryr', name: 'Ryanair weekly', organizations: [{ id: '1', name: 'Ryanair' }, { id: '2', name: 'Ryanair Crew' }], categoryField: { id: 'c', name: 'RYR Category', kind: 'option' }, subcategoryField: null };
const t = (created, category, org = 'Ryanair') => ({ id: String(Math.random()), created: Date.parse(created), resolved: null, orgs: [org], category, subcategory: null, logged: 0 });
const tickets = [t('2026-10-20T09:00:00Z', 'Device', 'Ryanair Crew'), t('2026-10-21T09:00:00Z', 'Device'), t('2026-10-21T10:00:00Z', 'Login'), t('2026-10-13T10:00:00Z', 'Login')];
const report = weeklyReport({ config, week, tickets, openNow: { all: 20, byOrg: { Ryanair: 12, 'Ryanair Crew': 8 } } });
const previous = { notes: sanitizeNotes({ actions: [{ action: 'Swap card readers at STN', owner: 'Service desk', status: 'In progress' }, { action: 'Done thing', status: 'Done' }] }) };
const reply = (args) => async (prompt) => ({ choices: [{ message: { tool_calls: [{ function: { name: prompt.tool_choice.function.name, arguments: JSON.stringify(args) } }] } }] });

test('AI input: figures per organisation, categories with examples, and open actions', () => {
  const input = weeklyAiInput(report, { examples: { Device: ['vPOS frozen'] }, openActions: carriedActions(previous) });
  assert.equal(input.all.created, 3);
  assert.deepEqual(input.byOrganization.map((o) => [o.organization, o.created]), [['Ryanair', 2], ['Ryanair Crew', 1]]);
  assert.deepEqual(input.categories.map((c) => [c.name, c.created, c.examples]), [['Device', 2, ['vPOS frozen']], ['Login', 1, []]]);
  assert.deepEqual(input.openActions, ['Swap card readers at STN']);
});

test('only actions not done carry over, as they were', () => {
  assert.deepEqual(carriedActions(previous), [{ action: 'Swap card readers at STN', owner: 'Service desk', due: '', status: 'In progress', source: 'carried' }]);
  assert.deepEqual(carriedActions(null), []);
});

test('suggestions: AI insights, carried actions first, repeats dropped', async () => {
  const prompts = [];
  const chatFn = async (p) => { prompts.push(p); return reply({ insights: ['Backlog fell to 20.', ' ', 'Device tickets doubled.'], actions: [{ action: 'swap card readers at STN' }, { action: 'Review Device tickets with the vendor', owner: 'Service desk' }, 'Check login errors'] })(p); };
  const s = await suggestWeeklyNotes(report, { previous, chatFn, models: ['claude-sonnet-5'], at: 'T' });
  assert.equal(s.insights, 'Backlog fell to 20.\nDevice tickets doubled.');
  assert.deepEqual(s.actions.map((a) => [a.action, a.source, a.status]), [['Swap card readers at STN', 'carried', 'In progress'], ['Review Device tickets with the vendor', 'ai', 'Open'], ['Check login errors', 'ai', 'Open']]);
  assert.equal(s.model, 'claude-sonnet-5');
  assert.match(prompts[0].messages[1].content, /"openActions":\["Swap card readers at STN"\]/);
});

test('an AI failure keeps the carried actions and records the error', async () => {
  const s = await suggestWeeklyNotes(report, { previous, chatFn: async () => { throw new Error('quota exceeded'); }, models: ['claude-sonnet-5'] });
  assert.equal(s.insights, '');
  assert.deepEqual(s.actions.map((a) => a.source), ['carried']);
  assert.match(s.error, /quota exceeded/);
  assert.throws(() => parseWeeklyNotes(null));
  assert.equal(parseWeeklyNotes({ insights: Array(9).fill('x'), actions: Array(9).fill({ action: 'a' }) }).actions.length, 5);
});

test('a build fills the notes until agents save their own', () => {
  const suggested = { insights: 'AI', actions: [{ action: 'A', owner: '', due: '', status: 'Open', source: 'ai' }] };
  assert.deepEqual(notesAfterBuild(null, suggested), { insights: 'AI', actions: suggested.actions, completed: '', inProgress: '', nextSteps: '' });
  assert.equal(notesAfterBuild({ notes: { insights: 'old', completed: 'kept' } }, suggested).completed, 'kept');
  const saved = { notesSavedAt: 'x', notes: { insights: 'mine', actions: [] } };
  assert.equal(notesAfterBuild(saved, suggested), saved.notes);
  assert.equal(sanitizeNotes({ actions: [{ action: 'x', source: 'ai' }, { action: 'y', source: 'hack' }] }).actions.map((a) => a.source).join(), 'ai,');
});

test('examples: summaries of tickets created in the week for the biggest categories', () => {
  const issues = tickets.map((_, i) => ({ fields: { summary: `S${i}` } }));
  assert.deepEqual(examplesOf(issues, tickets, week), { Device: ['S0', 'S1'], Login: ['S2'] });
});
