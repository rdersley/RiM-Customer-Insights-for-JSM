import test from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { buildReport } from '../src/analysis.js';
import { pdfContent, pdfFileName, pdfSafe, portalPdfContent, portalPdfFileName, PDF_DETAILS, PDF_ISSUES } from '../src/pdfReport.js';
import { portalView, snapshotFrom } from '../src/publish.js';
import { buildPdf } from '../static/app/src/exportPdf.js';

const PROBLEMS = ['Bluepad connection', 'vPOS crashed', 'Sync issues', 'Printer paper jam', 'Open barset', 'Card declined at checkout'];
function issues() {
  const out = [];
  let n = 0;
  for (let day = 1; day <= 28; day += 1) {
    for (const [i, problem] of PROBLEMS.entries()) {
      if ((day + i) % (i + 2)) continue;
      n += 1;
      out.push({
        key: `SD-${n}`,
        self: `https://example.atlassian.net/rest/api/3/issue/${n}`,
        dims: { base: [['DUB', 'STN', 'Kraków'][n % 3]] },
        fields: { summary: `RYR - CREW${n} - DUB - ${problem}`, description: '', created: `2026-09-${String(day).padStart(2, '0')}T0${n % 10}:15:00Z`, resolutiondate: n % 4 ? `2026-09-${String(day).padStart(2, '0')}T18:00:00Z` : null, status: { name: n % 4 ? 'Resolved' : 'Open' } },
      });
    }
  }
  return out;
}

function sampleReport() {
  const breakdowns = [{ id: 'base', label: 'Base', kind: 'option' }];
  const report = buildReport(issues(), '2026-09-15', '2026-09-28', null, { breakdowns, minPatternSize: 2 });
  return { ...report, organization: 'Ryanair Crew', organizations: [{ id: '188', name: 'Ryanair Crew' }], startDate: '2026-09-15', endDate: '2026-09-28', breakdownFields: breakdowns };
}

test('PDF content follows the report: numbers, issues, examples and sections', () => {
  const report = sampleReport();
  const c = pdfContent({ report, generatedAt: new Date('2026-10-07T12:00:00Z') });
  assert.equal(c.title, 'Ryanair Crew');
  assert.equal(c.period, '2026-09-15 to 2026-09-28');
  assert.equal(c.generated, '2026-10-07 12:00 UTC');
  assert.equal(c.kpis[0].value, String(report.currentCount));
  assert.equal(c.issues.length, Math.min(report.groups.length, PDF_ISSUES));
  assert.equal(c.issues[0].name, report.groups[0].theme);
  assert.match(c.issues[0].where, /^Base: /);
  assert.ok(c.issues[0].examples.length > 0 && c.issues[0].examples.length <= 3);
  assert.equal(c.issues.slice(PDF_DETAILS).every((i) => !i.examples.length), true);
  assert.equal(c.breakdowns[0].label, 'Base');
  assert.ok(c.timeOfDay.busiestDay);
  assert.equal(c.notes.length, 0);
});

test('AI names, summaries and follow-ups are used when there is an AI summary', () => {
  const report = sampleReport();
  const ai = { overview: 'Volume is steady.', actions: ['Check pinpads at DUB'], patterns: [{ index: 0, title: 'Payment device won’t connect', summary: 'Crew report the pinpad not pairing.' }] };
  const c = pdfContent({ report, ai, filter: { label: 'Base', value: 'DUB' } });
  assert.equal(c.issues[0].name, 'Payment device won’t connect');
  assert.equal(c.issues[0].summary, 'Crew report the pinpad not pairing.');
  assert.equal(c.overview, 'Volume is steady.');
  assert.deepEqual(c.actions, ['Check pinpads at DUB']);
  assert.match(c.notes[0], /Base is DUB/);
  assert.match(c.notes.at(-1), /AI-generated/);
});

test('a sampled report says so and marks sizes as estimates', () => {
  const report = { ...sampleReport(), sampled: true, analyzedCount: 900, currentCount: 2400 };
  report.groups = report.groups.map((g) => ({ ...g, estimated: true }));
  const c = pdfContent({ report });
  assert.match(c.notes[0], /900 of 2,400 tickets/);
  assert.match(c.issues[0].count, /^~/);
});

test('builds a multi-section PDF that jsPDF can write', () => {
  const report = sampleReport();
  const ai = { overview: 'Overview ≈ text with “quotes” and Kraków.', actions: ['One', 'Two'], patterns: [] };
  const doc = buildPdf(jsPDF, pdfContent({ report, ai }), { product: 'Customer Insights', version: '1.5.0' });
  const out = doc.output();
  assert.match(out, /^%PDF-/);
  assert.ok(doc.getNumberOfPages() >= 1);
  assert.match(out, /Customer Insights 1\.5\.0/);
});

test('long reports break across pages and keep every page numbered', () => {
  const report = sampleReport();
  const many = Array.from({ length: 40 }, (_, i) => ({ ...report.groups[0], id: `g${i}`, theme: `Issue number ${i} ${'with a long name '.repeat(i % 4)}` }));
  const doc = buildPdf(jsPDF, pdfContent({ report, groups: many }));
  const pages = doc.getNumberOfPages();
  assert.ok(pages > 2);
  for (let p = 1; p <= pages; p += 1) assert.match(doc.internal.pages[p].join('\n'), new RegExp(`Page ${p} of ${pages}`));
});

test('text is made safe for the built-in PDF fonts', () => {
  assert.equal(pdfSafe('≈25 → done'), '~25 -> done');
  assert.equal(pdfSafe('Kraków café – “ok”'), 'Kraków café – “ok”');
  assert.equal(pdfSafe('Łódź Gdańsk'), '?ódz Gdansk');
  assert.equal(pdfSafe('日本'), '??');
  assert.equal(pdfSafe(null), '');
});

test('file names are tidy', () => {
  assert.equal(pdfFileName({ organization: 'Ryanair Crew!', startDate: '2026-09-01', endDate: '2026-09-30' }), 'customer-insights-ryanair-crew-2026-09-01-2026-09-30.pdf');
  assert.equal(pdfFileName({ organization: 'A, B', organizations: [{}, {}], startDate: '2026-09-01', endDate: '2026-09-30' }), 'customer-insights-2-organisations-2026-09-01-2026-09-30.pdf');
});

test('the portal PDF shows only what the published report shows', () => {
  const grid = Array.from({ length: 7 }, (_, d) => Array.from({ length: 24 }, (_, h) => (d < 5 && h >= 9 && h < 12 ? 3 : 0)));
  const snapshot = portalView({ ...snapshotFrom({
    organization: { id: '188', name: 'Ryanair Crew' },
    period: { from: '2026-09-01', to: '2026-09-30' },
    totals: { current: 120, previous: 100 },
    timeSeries: [{ date: '2026-09-01', count: 60 }, { date: '2026-09-08', count: 60 }],
    patterns: [
      { title: 'Bluepad connection', summary: 'Pads drop off the network.', count: 40, previousCount: 20, medianHours: 5, openShare: 10, hours: grid[0],
        examples: [{ key: 'SD-1', summary: 'Bluepad offline', status: 'Resolved', url: 'https://x.atlassian.net/servicedesk/customer/portal/2/SD-1' }] },
      { title: 'Printer paper jam', count: 5, previousCount: 0, estimated: true },
    ],
    overview: 'Bluepad issues doubled.',
    actions: ['Check the access points at DUB.'],
    resolution: { medianHours: 30, openShare: 12 },
    breakdowns: [{ label: 'Base', values: [{ value: 'DUB', count: 30, previousCount: 20, medianHours: 4 }] }],
    timeOfDay: { timeZone: 'Europe/Dublin', grid },
    unreviewed: [{ title: 'Agent-only note', count: 3 }],
  }, { detailed: true }), publishedBy: 'abc' });

  const c = portalPdfContent(snapshot, { generatedAt: new Date('2026-10-01T09:00:00Z') });
  assert.equal(c.noun, 'Request');
  assert.equal(c.title, 'Ryanair Crew');
  assert.deepEqual(c.kpis.map((k) => k.value), ['120', '+20%', '2', '1.3 days']);
  assert.equal(c.issues[0].change, '+100%');
  assert.equal(c.issues[0].resolution, '5 h to resolve · 10% open');
  assert.deepEqual(c.issues[0].examples, [{ key: 'SD-1', summary: 'Bluepad offline', status: 'Resolved' }]);
  assert.equal(c.issues[1].count, '~5');
  assert.equal(c.issues[1].change, 'New');
  assert.equal(c.breakdowns[0].values[0].change, '+50%');
  assert.equal(c.timeOfDay.timeZone, 'Europe/Dublin');
  assert.equal(c.timeOfDay.outOfHours, '0%');
  assert.deepEqual(c.dataQuality, []);
  assert.ok(!JSON.stringify(c).includes('Agent-only note'));
  assert.equal(portalPdfFileName(snapshot), 'service-report-ryanair-crew-2026-09-01-2026-09-30.pdf');

  const doc = buildPdf(jsPDF, c, { product: 'Customer Insights', version: '1.6.0' });
  assert.ok(doc.getNumberOfPages() >= 1);
  assert.ok(doc.output().length > 2000);
});
