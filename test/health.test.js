import test from 'node:test';
import assert from 'node:assert/strict';
import { addHistory, agedBacklog, bandOf, changeOver, healthOf, isRising, sanitizeHealth, satisfactionOf } from '../src/health.js';
import { healthPeriod, isHealthDue } from '../src/healthJobs.js';
import { healthSection, pdfContent } from '../src/pdfReport.js';

const report = (change = {}) => ({
  currentCount: 120,
  previousCount: 100,
  groups: [{ count: 30, previousCount: 10 }, { count: 6, previousCount: 0 }, { count: 20, previousCount: 19 }],
  sla: [{ id: 'a', met: 80, breached: 20 }],
  satisfaction: { average: 4, rated: 12 },
  ...change,
});

test('each signal is scored 0–100 and weighted into one score', () => {
  const h = healthOf(report(), { open: 50, aged: 10 });
  const by = Object.fromEntries(h.signals.map((s) => [s.key, s.score]));
  // +20% volume -> 60; rising 36 of 120 = 30% -> 25; SLA 80% met -> 40; aged 20% -> 60; CSAT 4.0 -> 80.
  assert.deepEqual(by, { volume: 60, rising: 25, sla: 40, backlog: 60, satisfaction: 80 });
  assert.equal(h.score, Math.round((60 * 20 + 25 * 20 + 40 * 25 + 60 * 20 + 80 * 15) / 100));
  assert.equal(h.band.label, 'Watch');
  assert.equal(h.weakest, 'rising');
  assert.equal(h.signals.reduce((n, s) => n + s.share, 0), 100);
});

test('signals without enough data are left out and the rest weighted up', () => {
  const h = healthOf(report({ sla: [], satisfaction: null, previousCount: 4 }), null);
  assert.deepEqual(h.signals.map((s) => s.key), ['rising']);
  assert.equal(h.score, null);
  const two = healthOf(report({ sla: [], satisfaction: null }), null);
  assert.deepEqual(two.signals.map((s) => [s.key, s.share]), [['volume', 50], ['rising', 50]]);
  assert.equal(two.score, Math.round((60 + 25) / 2));
});

test('a quiet, improving customer is healthy', () => {
  const h = healthOf(report({ currentCount: 80, groups: [{ count: 10, previousCount: 12 }], sla: [{ met: 98, breached: 2 }], satisfaction: { average: 4.7, rated: 20 } }), { open: 3, aged: 2 });
  assert.equal(h.score, 100);
  assert.equal(h.band.label, 'Healthy');
  assert.equal(h.weakest, null);
  assert.match(h.signals.find((s) => s.key === 'backlog').detail, /3 open tickets/);
});

test('rising issues, bands, backlog from the flow card and satisfaction ratings', () => {
  assert.equal(isRising({ count: 5, previousCount: 0 }), true);
  assert.equal(isRising({ count: 4, previousCount: 0 }), false);
  assert.equal(isRising({ count: 6, previousCount: 4 }), false); // +2 only
  assert.equal(isRising({ count: 9, previousCount: 6 }), true);
  assert.deepEqual([bandOf(75).label, bandOf(74).label, bandOf(49).label, bandOf(null)], ['Healthy', 'Watch', 'At risk', null]);
  assert.deepEqual(agedBacklog({ open: 40, ages: [{ count: 10 }, { count: 10 }, { count: 15 }, { count: 5 }] }), { open: 40, aged: 20 });
  const issues = [{ fields: { cf: { rating: 5 } } }, { fields: { cf: { rating: 2 } } }, { fields: { cf: null } }];
  assert.deepEqual(satisfactionOf(issues, 'cf'), { average: 3.5, rated: 2 });
  assert.equal(satisfactionOf(issues, null), null);
});

test('history keeps one point a day and the 7-day change', () => {
  let h = [];
  for (let d = 1; d <= 10; d += 1) h = addHistory(h, `2026-10-${String(d).padStart(2, '0')}`, 50 + d);
  h = addHistory(h, '2026-10-10', 70); // same day replaced
  assert.equal(h.length, 10);
  assert.equal(changeOver(h, 7), 70 - 53);
  assert.equal(changeOver(h.slice(-3), 7), null);
  let long = [];
  for (let d = 0; d < 100; d += 1) long = addHistory(long, new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10), 50);
  assert.equal(long.length, 90);
});

test('settings keep known organisations once, and the daily run timing', () => {
  const s = sanitizeHealth({ enabled: true, organizations: [{ id: 1 }, '1', { id: 3 }, { id: 2 }] }, [{ id: '1', name: 'Acme' }, { id: '2', name: 'Globex' }]);
  assert.deepEqual(s, { enabled: true, organizations: [{ id: '1', name: 'Acme' }, { id: '2', name: 'Globex' }] });
  assert.deepEqual(healthPeriod(new Date('2026-10-16T09:00:00Z')), { from: '2026-09-16', to: '2026-10-15' });
  const at = (iso) => new Date(iso);
  assert.equal(isHealthDue(null, at('2026-10-16T04:00:00Z')), false);
  assert.equal(isHealthDue(null, at('2026-10-16T05:00:00Z')), true);
  assert.equal(isHealthDue({ date: '2026-10-16' }, at('2026-10-16T09:00:00Z')), false);
  assert.equal(isHealthDue({ date: '2026-10-15', queuedAt: '2026-10-16T08:30:00Z' }, at('2026-10-16T09:00:00Z')), false);
  assert.equal(isHealthDue({ date: '2026-10-15', queuedAt: '2026-10-16T05:00:00Z' }, at('2026-10-16T09:00:00Z')), true);
});

test('the PDF has a health section only when one is passed', () => {
  const r = { ...report(), organization: 'Acme', startDate: '2026-10-01', endDate: '2026-10-10', timeSeries: [] };
  assert.equal(pdfContent({ report: r }).health, null);
  const section = pdfContent({ report: r, health: healthOf(r, { open: 50, aged: 10 }) }).health;
  assert.equal(section.band, 'Watch');
  assert.equal(section.signals.length, 5);
  assert.equal(healthSection({ score: null, signals: [] }), null);
});

test('the PDF draws the health section', async () => {
  const { jsPDF } = await import('jspdf');
  const { buildPdf } = await import('../static/app/src/exportPdf.js');
  const r = { ...report(), organization: 'Acme', startDate: '2026-10-01', endDate: '2026-10-10', timeSeries: [] };
  const content = pdfContent({ report: r, health: healthOf(r, { open: 50, aged: 10 }) });
  const text = (c) => { const doc = buildPdf(jsPDF, c); return doc.output(); };
  assert.ok(text(content).length > text({ ...content, health: null }).length);
});
