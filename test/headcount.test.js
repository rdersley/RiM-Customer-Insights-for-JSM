import test from 'node:test';
import assert from 'node:assert/strict';
import { crewFromFile, crewRates, csvRows, sanitizeHeadcounts } from '../src/headcount.js';
import { sanitizeSettings } from '../src/settings.js';
import { snapshotFrom } from '../src/publish.js';
import { crewSection } from '../src/pdfReport.js';

const CREW_LIST = [
  'CrewCode,FirstName,LastName,DateOfEntry,EmploymentEndDate,Base,Role,PhoneNumber,Email,EmployeeNumber,Gender,BaseDateFrom,BaseDateTo',
  'AAA1,Ann,"Smith, Jr",2024-04-02 00:00:00,2035-12-31 00:00:00,STN,8,,a@example.com,1,F,01/12/2025,31/12/2035',
  'AAA2,Bob,Jones,2024-04-02 00:00:00,2035-12-31 00:00:00,stn,8,,b@example.com,2,M,01/12/2025,31/12/2035',
  'AAA3,Cat,Lee,2024-04-02 00:00:00,2035-12-31 00:00:00,DUB,5,,c@example.com,3,F,01/12/2025,31/12/2035',
  'AAA4,Dan,Old,2020-01-01 00:00:00,2025-01-31 00:00:00,DUB,8,,d@example.com,4,M,01/01/2020,31/12/2035',
  'AAA5,Eve,Moving,2024-04-02 00:00:00,2035-12-31 00:00:00,ORK,8,,e@example.com,5,F,01/12/2026,31/12/2035',
].join('\r\n');

test('a crew list becomes counts per base, skipping leavers and future moves', () => {
  const result = crewFromFile(CREW_LIST, { today: '2026-10-09' });
  assert.deepEqual(result.values, [{ value: 'STN', count: 2 }, { value: 'DUB', count: 1 }]);
  assert.equal(result.total, 3);
  assert.equal(result.skipped, 2);
  // Only counts: no names or emails anywhere in the result.
  assert.ok(!/Smith|example\.com|AAA1/.test(JSON.stringify(result)));
});

test('a short "base, number" list works too, with or without a header', () => {
  assert.deepEqual(crewFromFile('Base,Crew\nSTN,"1,194"\nDUB,920\n').values, [{ value: 'STN', count: 1194 }, { value: 'DUB', count: 920 }]);
  assert.deepEqual(crewFromFile('STN;12\nKUN;3').values, [{ value: 'STN', count: 12 }, { value: 'KUN', count: 3 }]);
  assert.throws(() => crewFromFile('Name,Email\nAnn,a@example.com'), /No bases found/);
  assert.deepEqual(csvRows('a,"b ""c"", d"\n'), [['a', 'b "c", d']]);
});

const orgs = [{ id: '188', name: 'Ryanair Crew' }, { id: '7', name: 'Other' }];
const fields = [{ id: 'customfield_1', name: 'Base or Location', kind: 'option' }];

test('crew numbers are validated against organisations and breakdown fields', () => {
  const clean = sanitizeHeadcounts([
    { organization: { id: '188', name: 'renamed' }, fieldId: 'customfield_1', values: [{ value: 'STN', count: 10 }, { value: 'stn', count: 5 }, { value: 'X', count: -1 }], portal: true, updatedAt: '2026-10-09T10:00:00.000Z', source: 'crew.csv' },
    { organization: { id: '188' }, fieldId: 'customfield_1', values: [{ value: 'DUB', count: 1 }] },
    { organization: { id: '999' }, fieldId: 'customfield_1', values: [{ value: 'DUB', count: 1 }] },
    { organization: { id: '7' }, fieldId: 'customfield_9', values: [{ value: 'DUB', count: 1 }] },
  ], orgs, [{ id: 'customfield_1' }]);
  assert.deepEqual(clean, [{ organization: { id: '188', name: 'Ryanair Crew' }, fieldId: 'customfield_1', values: [{ value: 'STN', count: 10 }], updatedAt: '2026-10-09T10:00:00.000Z', source: 'crew.csv', portal: true }]);
  const settings = sanitizeSettings({ breakdowns: [{ id: 'customfield_1', label: 'Base' }], headcounts: clean }, fields, orgs);
  assert.equal(settings.headcounts.length, 1);
  assert.deepEqual(sanitizeSettings({ headcounts: clean }, fields, orgs).headcounts, []);
});

const headcount = { organization: { id: '188', name: 'Ryanair Crew' }, fieldId: 'customfield_1', updatedAt: '2026-10-09T10:00:00.000Z',
  values: [{ value: 'STN', count: 1000 }, { value: 'DUB', count: 900 }, { value: 'KUN', count: 70 }, { value: 'VTC', count: 10 }] };
const report = {
  currentCount: 600, previousCount: 400,
  breakdowns: [{ id: 'customfield_1', label: 'Base or Location', estimated: false, withoutValue: 40, values: [],
    all: [['STN', 200, 150], ['DUB', 150, 100], ['KUN', 60, 20], ['XYZ', 5, 0]] }],
};

test('tickets per 100 crew: overall, per base and against the average', () => {
  const r = crewRates(report, headcount);
  assert.equal(r.crew, 1980);
  assert.equal(r.rate, 30.3);
  assert.equal(r.previousRate, 20.2);
  assert.equal(r.average, 20.7); // 410 tickets at bases with crew numbers / 1980
  assert.deepEqual(r.bases.map((b) => [b.value, b.tickets, b.rate, b.ratio, b.small]), [
    ['KUN', 60, 85.7, 4.1, false],
    ['STN', 200, 20, 1, false],
    ['DUB', 150, 16.7, 0.8, false],
    ['VTC', 0, 0, 0, true],
  ]);
  assert.deepEqual(r.unmatched, [{ value: 'XYZ', tickets: 5 }]);
  assert.equal(crewRates({ ...report, filter: { id: 'x' } }, headcount).rate, null);
  assert.equal(crewRates(report, { ...headcount, fieldId: 'nope' }), null);
});

test('crew rates survive the portal snapshot and go in the PDF', () => {
  const crewRatesValue = crewRates(report, headcount);
  const snapshot = snapshotFrom({ organization: { id: '188', name: 'Ryanair Crew' }, period: { from: '2026-09-01', to: '2026-09-30' }, crewRates: crewRatesValue }, { detailed: true });
  assert.equal(snapshot.crewRates.bases[0].value, 'KUN');
  assert.equal(snapshot.crewRates.rate, 30.3);
  assert.equal('unmatched' in snapshot.crewRates, false);
  assert.equal(snapshotFrom({ organization: { id: '188', name: 'R' }, period: { from: '2026-09-01', to: '2026-09-30' }, crewRates: crewRatesValue }).crewRates, undefined);
  const section = crewSection(crewRatesValue);
  assert.match(section.summary, /1,980 crew at 4 bases · 30\.3 tickets per 100 crew/);
  assert.deepEqual(section.bases[0], { value: 'KUN', crew: '70', tickets: '60', rate: '85.7', ratio: '4.1x', previous: '28.6' });
  assert.equal(section.bases[3].value, 'VTC *');
  assert.equal(crewSection(null), null);
});
