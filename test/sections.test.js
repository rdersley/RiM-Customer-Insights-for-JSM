import test from 'node:test';
import assert from 'node:assert/strict';
import { hiddenFor, sanitizeHiddenSections, sectionsFor } from '../src/sections.js';
import { pdfContent } from '../src/pdfReport.js';
import { sanitizeSettings } from '../src/settings.js';

test('hidden sections: known keys per kind of report, once each', () => {
  assert.deepEqual(sanitizeHiddenSections({ customers: ['sla', 'sla', 'team', 'nope', 'health'], internal: ['team', 'health', 'sla'] }),
    { customers: ['sla', 'health'], internal: ['team', 'sla'] });
  assert.deepEqual(sanitizeHiddenSections(null), { customers: [], internal: [] });
  assert.ok(sectionsFor('customers').some((s) => s.key === 'crew') && !sectionsFor('internal').some((s) => s.key === 'crew'));
  const hidden = { customers: ['sla'], internal: ['team'] };
  assert.deepEqual(hiddenFor(hidden, { scope: 'internal' }), ['team']);
  assert.deepEqual(hiddenFor(hidden, { organization: { id: '1' } }), ['sla']);
  assert.deepEqual(sanitizeSettings({ hiddenSections: { customers: ['sla'] } }, []).hiddenSections, { customers: ['sla'], internal: [] });
});

test('the PDF leaves out hidden sections', () => {
  const report = {
    organization: 'Acme', startDate: '2026-10-01', endDate: '2026-10-10', currentCount: 10, previousCount: 8, changePercent: 25, minPatternSize: 2,
    groups: [], timeSeries: [{ date: '2026-10-01', count: 10 }],
    breakdowns: [{ label: 'Base', values: [{ value: 'A', count: 10, previousCount: 8 }] }],
    timeOfDay: { analysed: 10, timeZone: 'UTC', grid: Array.from({ length: 7 }, () => Array(24).fill(1)) },
  };
  const all = pdfContent({ report });
  assert.equal(all.breakdowns.length, 1);
  assert.ok(all.timeOfDay && all.volume.points.length);
  const some = pdfContent({ report: { ...report, hiddenSections: ['breakdowns', 'timeOfDay', 'activity', 'ai'] }, ai: { overview: 'x', actions: ['y'] } });
  assert.deepEqual(some.breakdowns, []);
  assert.equal(some.timeOfDay, null);
  assert.deepEqual(some.volume.points, []);
  assert.equal(some.overview, '');
});
