import test from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { weeklyPdfContent, weeklyPdfFileName } from '../src/weeklyPdf.js';
import { buildWeeklyPdf } from '../static/app/src/exportWeeklyPdf.js';
import { sanitizeNotes, weeklyReport, weekOf } from '../src/weekly.js';

const week = weekOf('2026-10-26');
const config = { id: 'w-ryr', name: 'Ryanair weekly', organizations: [{ id: '1', name: 'Ryanair' }, { id: '2', name: 'Ryanair Crew' }], categoryField: { id: 'c', name: 'RYR Category', kind: 'option' }, subcategoryField: null };
const t = (created, category, org = 'Ryanair', resolved = null) => ({ id: String(Math.random()), created: Date.parse(created), resolved: resolved ? Date.parse(resolved) : null, orgs: [org], category, subcategory: null, logged: 0 });
const tickets = [t('2026-10-27T09:00:00Z', 'Device', 'Ryanair Crew', '2026-10-28T09:00:00Z'), t('2026-10-28T09:00:00Z', 'Device'), t('2026-10-29T10:00:00Z', 'Login'), t('2026-10-20T10:00:00Z', 'Login')];
const report = { ...weeklyReport({ config, week, tickets, openNow: { all: 20, byOrg: { Ryanair: 12, 'Ryanair Crew': 8 } } }), builtAt: '2026-11-03T06:00:00Z' };
const record = { ...report, notes: sanitizeNotes({ insights: 'Backlog fell.\nDevice tickets doubled.', actions: [{ action: 'Swap card readers at STN', owner: 'Device team', due: '14 Nov', status: 'In progress' }], completed: '- Replaced STN router', nextSteps: '' }) };

test('weekly PDF content: same sections as the page and Excel, in order', () => {
  const c = weeklyPdfContent(record);
  assert.equal(c.title, 'Ryanair weekly');
  assert.match(c.subtitle, /Monday to Sunday/);
  assert.deepEqual(c.sections.map((s) => s.title), ['Key metrics', 'Top issues', 'Workload to resolve tickets', 'Insights', 'Action register', 'Progress']);
  const metrics = c.sections[0];
  assert.deepEqual(metrics.tables[0].columns.map((col) => col.label), ['', 'All', 'Ryanair', 'Ryanair Crew']);
  assert.equal(metrics.kpis[1].value, '3');
  assert.deepEqual(c.sections[3].bullets, ['Backlog fell.', 'Device tickets doubled.']);
  assert.deepEqual(c.sections[4].tables[0].rows[0], ['Swap card readers at STN', 'Device team', '14 Nov', 'In progress']);
  const progress = c.sections[5].groups;
  assert.deepEqual(progress[0].bullets, ['Replaced STN router']);
  assert.deepEqual(progress[2].notes, ['–']); // empty next steps
  assert.equal(weeklyPdfFileName(record), 'ryanair-weekly-2026-10-26.pdf');
});

test('the weekly PDF draws, and runs to more pages with many actions', () => {
  const small = buildWeeklyPdf(jsPDF, weeklyPdfContent(record));
  assert.ok(small.getNumberOfPages() >= 1);
  assert.ok(small.output().startsWith('%PDF'));
  const many = { ...record, notes: sanitizeNotes({ ...record.notes, actions: Array.from({ length: 30 }, (_, i) => ({ action: `Action ${i} with a fairly long description that wraps onto a second line in the table`, owner: 'Service desk', status: 'Open' })) }) };
  assert.ok(buildWeeklyPdf(jsPDF, weeklyPdfContent(many)).getNumberOfPages() > small.getNumberOfPages());
});
