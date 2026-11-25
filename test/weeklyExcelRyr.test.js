// The Ryanair-style weekly workbook: backlog over three weeks, tickets by
// category with last week, AI issue trends per focus category, and the ticket
// lists read when someone downloads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { backlogWeeks, categoryTables, focusOf, sanitizeWeekly, sanitizeNotes, shortWeek, weekOf, weeklyReport } from '../src/weekly.js';
import { parseTrends, suggestTrends } from '../src/weeklyAi.js';
import { trendInput } from '../src/weeklyJobs.js';
import { display, excelDate, keepRow, listColumns, listJql, rowOf } from '../src/weeklyRows.js';
import { weeklySheets, wowChange } from '../src/weeklyExcel.js';
import { workbook } from '../src/xlsx.js';

const at = (iso) => Date.parse(iso);
const week = weekOf('2026-11-09'); // 9–15 November
let n = 0;
const t = (created, resolved = null, extra = {}) => ({ id: String(++n), key: `SD-${n}`, created: at(created), resolved: resolved ? at(resolved) : null, orgs: ['Ryanair'], category: 'vPos Device', subcategory: 'P2P', logged: 0, ...extra });

// An old open ticket, one resolved the week before, and this week's mix.
const tickets = [
  t('2026-09-01T10:00:00Z'), // open throughout
  t('2026-10-27T10:00:00Z', '2026-11-03T10:00:00Z', { category: 'Faulty/Replacement Hardware', subcategory: 'Bluepad' }), // created wk-2, resolved wk-1
  t('2026-11-03T10:00:00Z', null, { orgs: ['Ryanair Crew'] }), // created last week, open
  t('2026-11-10T10:00:00Z', null, { category: 'Faulty/Replacement Hardware', subcategory: 'Bluepad', orgs: ['Ryanair Crew'] }),
  t('2026-11-11T10:00:00Z', '2026-11-12T10:00:00Z'), // created and resolved this week
  t('2026-11-12T10:00:00Z', '2026-11-18T10:00:00Z', { category: 'Faulty/Replacement Hardware', subcategory: 'Battery' }), // resolved after the week: open at its end
];
const config = { id: 'w-ryr', name: 'Ryanair weekly', organizations: [{ id: '1', name: 'Ryanair' }, { id: '2', name: 'Ryanair Crew' }], categoryField: { id: 'cf_module', name: 'Module type', kind: 'cascading' }, subcategoryField: null };

test('settings keep up to two focus categories with short labels', () => {
  const orgs = [{ id: '1', name: 'Ryanair' }];
  const { reports } = sanitizeWeekly({ reports: [{ name: 'R', organizations: [{ id: '1' }], focus: [{ name: ' vPos Device ', label: 'vPOS' }, { name: '' }, { name: 'Faulty/Replacement Hardware', label: 'Hardware and more' }, { name: 'Third' }] }] }, orgs, []);
  assert.deepEqual(reports[0].focus, [{ name: 'vPos Device', label: 'vPOS' }, { name: 'Faulty/Replacement Hardware', label: 'Hardware and' }]);
  assert.deepEqual(sanitizeWeekly({ reports: [{ name: 'R', organizations: [{ id: '1' }] }] }, orgs, []).reports[0].focus, []);
});

test('focus: as set, or the two biggest categories created in the week', () => {
  assert.deepEqual(focusOf({ focus: [{ name: 'vPos Device', label: '' }] }, tickets, week), [{ name: 'vPos Device', label: 'vPos Device' }]);
  assert.deepEqual(focusOf({}, tickets, week).map((f) => f.name), ['Faulty/Replacement Hardware', 'vPos Device']);
});

test('backlog over three weeks: open at each week end counted ticket by ticket, created per org and focus', () => {
  const focus = [{ name: 'vPos Device', label: 'vPOS' }, { name: 'Faulty/Replacement Hardware', label: 'Hardware' }];
  const weeks = backlogWeeks(tickets, week, { organizations: config.organizations, focus });
  assert.deepEqual(weeks.map(shortWeek), ['26.10-01.11', '02.11-08.11', '09.11-15.11']);
  assert.deepEqual(weeks.map((w) => w.open), [2, 2, 4]);
  assert.deepEqual(weeks.map((w) => w.created), [1, 1, 3]);
  assert.deepEqual(weeks.map((w) => w.resolved), [0, 1, 1]);
  assert.deepEqual(weeks[2].createdByOrg, [{ name: 'Ryanair', count: 2 }, { name: 'Ryanair Crew', count: 1 }]);
  assert.deepEqual(weeks[2].createdByFocus.map((f) => f.count), [1, 2]);
  assert.equal(weeks[2].createdChange, 200);
  assert.equal(weeks[0].createdChange, null);
  // % resolved: 1 ÷ (2 open at the start + 3 created).
  assert.equal(weeks[2].resolvedPct, 20);
  // Age at Sunday midnight (Irish time = UTC in November) of the 4 open tickets.
  const end = week.end;
  const expected = Math.round(([tickets[0], tickets[2], tickets[3], tickets[5]].reduce((s, x) => s + (end - x.created), 0) / 4 / 86400000) * 10) / 10;
  assert.equal(weeks[2].avgOpenAgeDays, expected);
});

test('categories: open at the end of the week and created in it, with subcategories and last week', () => {
  const { open, created } = categoryTables(tickets, week);
  // Level on 2: more last week goes first.
  assert.deepEqual(open.map((c) => [c.name, c.count, c.previous]), [['vPos Device', 2, 2], ['Faulty/Replacement Hardware', 2, 0]]);
  assert.deepEqual(open[1].children.map((s) => [s.name, s.count]), [['Battery', 1], ['Bluepad', 1]]);
  assert.deepEqual(created.map((c) => [c.name, c.count, c.previous]), [['Faulty/Replacement Hardware', 2, 0], ['vPos Device', 1, 1]]);
  assert.deepEqual([wowChange(3, 2), wowChange(2, 0), wowChange(0, 0)], [50, 'New', null]);
});

test('trends: ticket numbers become keys, each ticket counted once, ranked by count', () => {
  const list = [{ key: 'SD-1' }, { key: 'SD-2' }, { key: 'SD-3' }, { key: 'SD-4' }];
  const raw = { trends: [
    { title: 'Charging port broken', devices: 'PIN pads', tickets: [3], example: 3, exampleText: 'Port fell inside.' },
    { title: 'Pairing failures', devices: 'PIN pads and vPOS', tickets: [1, 2, 2, 9], example: 7, exampleText: 'Would not pair.' },
    { title: 'Duplicate', tickets: [1] },
  ] };
  assert.deepEqual(parseTrends(raw, list), [
    { rank: 1, title: 'Pairing failures', devices: 'PIN pads and vPOS', count: 2, keys: ['SD-1', 'SD-2'], exampleKey: 'SD-1', example: 'Would not pair.' },
    { rank: 2, title: 'Charging port broken', devices: 'PIN pads', count: 1, keys: ['SD-3'], exampleKey: 'SD-3', example: 'Port fell inside.' },
  ]);
});

test('trends: the overview is sent by number, the output limit raised, failures recorded', async () => {
  const sent = [];
  const chatFn = async (req) => {
    sent.push(req);
    return { choices: [{ message: { tool_calls: [{ function: { name: 'issue_trends', arguments: JSON.stringify({ trends: [{ title: 'Pairing', tickets: [1, 2], example: 2, exampleText: 'x' }] }) } }] } }] };
  };
  const groups = [{ name: 'vPos Device', label: 'vPOS', tickets: [{ key: 'SD-9', text: 'Pairing failed' }, { key: 'SD-8', text: 'No pairing' }] }, { name: 'Empty', label: 'E', tickets: [] }];
  const out = await suggestTrends(groups, { chatFn, models: ['m'] });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].max_completion_tokens, 6000);
  assert.match(sent[0].messages[1].content, /"n":1,"text":"Pairing failed"/);
  assert.doesNotMatch(sent[0].messages[1].content, /SD-9/);
  assert.deepEqual(out.groups[0].trends[0].keys, ['SD-9', 'SD-8']);
  assert.equal(out.groups[0].trends[0].exampleKey, 'SD-8');
  assert.deepEqual(out.groups[1], { name: 'Empty', label: 'E', tickets: 0, trends: [], model: null, error: null });
  const failed = await suggestTrends(groups.slice(0, 1), { chatFn: async () => { throw new Error('busy'); }, models: ['m'] });
  assert.match(failed.groups[0].error, /busy/);
});

test('trend input: this week’s tickets in each focus category, overview or title, newest first', () => {
  const issues = tickets.map((x) => ({ key: x.key, fields: { summary: `Title ${x.key}`, cf_ai: x.key === 'SD-6' ? { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Battery fails' }] }] } : null } }));
  const [hw] = trendInput(issues, tickets, week, [{ name: 'Faulty/Replacement Hardware', label: 'Hardware' }], 'cf_ai');
  assert.deepEqual(hw.tickets, [{ key: 'SD-6', text: 'Battery fails' }, { key: 'SD-4', text: 'Title SD-4' }]);
});

const fieldList = [
  { id: 'cf_crew', name: 'Crew Code/Reporter:', schema: { type: 'string' } },
  { id: 'cf_dev1', name: 'Device Type', schema: { type: 'option' } },
  { id: 'cf_dev2', name: 'Device Type ', schema: { type: 'option' } },
  { id: 'cf_sent', name: 'Date Sent', schema: { type: 'date' } },
  { id: 'cf_sol', name: 'Solution Type', schema: { type: 'option-with-child' } },
];

test('ticket list columns: named fields that exist, the category split, the overview', () => {
  const columns = listColumns(fieldList, { categoryField: config.categoryField, overviewFieldId: 'cf_ai' });
  assert.deepEqual(columns.map((c) => c.label), ['Key', 'Summary', 'Status', 'Created', 'Reporter', 'Crew Code/Reporter:', 'Priority', 'Module type', 'Module type (parent)', 'Module type (child)',
    'Device Type', 'Date Sent', 'Resolution', 'Resolved', 'Solution Type', 'Age (days)', 'Ticket overview']);
  assert.deepEqual(columns.find((c) => c.label === 'Device Type').ids, ['cf_dev1', 'cf_dev2']);
  assert.equal(columns.find((c) => c.label === 'Date Sent').type, 'date');
  // A one-level category has no parent/child columns; no AI field, no overview.
  const plain = listColumns([], { categoryField: { id: 'c', name: 'Category', kind: 'option' } }).map((c) => c.label);
  assert.ok(plain.includes('Category') && !plain.includes('Category (parent)') && !plain.includes('Ticket overview'));
});

test('a ticket row: values as text, dates as Excel dates in Irish time, age, category parent', () => {
  const columns = listColumns(fieldList, { categoryField: config.categoryField, overviewFieldId: 'cf_ai' });
  const issue = { key: 'SD-351114', fields: {
    summary: 'RYR - Vpos disconnecting', status: { name: 'Awaiting Customer Feedback' }, created: '2026-07-15T22:30:00.000+0000', reporter: { displayName: 'Crew member' },
    cf_crew: 'MNUNEZ', priority: { name: 'P3' }, cf_module: { value: 'vPos Device ', child: { value: '3rd Party App Issues' } }, cf_dev1: null, cf_dev2: { value: 'Bluepad-50' },
    cf_sent: '2026-07-16', resolution: null, resolutiondate: null, cf_sol: { value: 'No Action Required', child: { value: 'No Action Required' } },
    cf_ai: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'The vPOS kept disconnecting.' }] }] },
  } };
  const row = rowOf(issue, columns, at('2026-07-18T22:00:00Z'));
  const cell = (label) => row.cells[columns.findIndex((c) => c.label === label)];
  assert.equal(row.category, 'vPos Device');
  assert.equal(cell('Module type'), 'vPos Device  - 3rd Party App Issues');
  assert.deepEqual([cell('Module type (parent)'), cell('Module type (child)')], ['vPos Device', '3rd Party App Issues']);
  assert.equal(cell('Device Type'), 'Bluepad-50');
  assert.equal(cell('Solution Type'), 'No Action Required - No Action Required');
  assert.equal(cell('Ticket overview'), 'The vPOS kept disconnecting.');
  assert.equal(cell('Age (days)'), 2);
  assert.equal(cell('Resolved'), null);
  // 22:30 UTC on 15 July is 23:30 Irish summer time.
  assert.equal(cell('Created'), excelDate('2026-07-15T22:30:00.000+0000', 'datetime'));
  assert.equal(Math.round((cell('Created') % 1) * 24 * 60), 23 * 60 + 30);
  assert.equal(cell('Date Sent'), 46219);
  assert.deepEqual([display([{ name: 'A' }, { value: 'B' }]), display(null), display(5)], ['A, B', '', '5']);
});

test('list JQL is a day wider; rows are kept by the exact week', () => {
  assert.equal(listJql(config, week, 'open'), 'organizations in ("Ryanair", "Ryanair Crew") AND created < "2026-11-17" AND (resolution = Unresolved OR resolved >= "2026-11-15") ORDER BY created DESC');
  assert.equal(listJql(config, week, 'created'), 'organizations in ("Ryanair", "Ryanair Crew") AND created >= "2026-11-08" AND created < "2026-11-17" ORDER BY created DESC');
  const issue = (created, resolutiondate = null) => ({ fields: { created, resolutiondate } });
  assert.equal(keepRow(issue('2026-11-15T23:30:00Z'), week, 'created'), true);
  assert.equal(keepRow(issue('2026-11-16T00:30:00Z'), week, 'created'), false);
  assert.equal(keepRow(issue('2026-11-01T10:00:00Z', '2026-11-15T23:00:00Z'), week, 'open'), false);
  assert.equal(keepRow(issue('2026-11-01T10:00:00Z', '2026-11-16T09:00:00Z'), week, 'open'), true);
  assert.equal(keepRow(issue('2026-11-01T10:00:00Z'), week, 'open'), true);
});

/** Reads a stored zip back: { path: text }. */
function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = {};
  let p = 0;
  while (view.getUint32(p, true) === 0x04034B50) {
    const size = view.getUint32(p + 18, true);
    const nameLength = view.getUint16(p + 26, true);
    const name = new TextDecoder().decode(bytes.slice(p + 30, p + 30 + nameLength));
    out[name] = new TextDecoder().decode(bytes.slice(p + 30 + nameLength, p + 30 + nameLength + size));
    p += 30 + nameLength + size;
  }
  return out;
}

test('the workbook follows the Ryanair layout, with ticket sheets per focus category', () => {
  const focus = [{ name: 'vPos Device', label: 'vPOS' }, { name: 'Faulty/Replacement Hardware', label: 'Hardware' }];
  const report = weeklyReport({ config, week, tickets, openNow: { all: 4, byOrg: { Ryanair: 3, 'Ryanair Crew': 1 } }, builtAt: '2026-11-16T01:00:00Z' });
  const trends = { at: 'x', groups: [
    { name: 'vPos Device', label: 'vPOS', tickets: 1, sent: 1, trends: [{ rank: 1, title: 'P2P fails', devices: 'vPOS phones', count: 1, keys: ['SD-5'], exampleKey: 'SD-5', example: 'Master would not connect.' }], model: 'm', error: null },
    { name: 'Faulty/Replacement Hardware', label: 'Hardware', tickets: 2, trends: [], model: null, error: 'busy' },
  ] };
  const record = { ...report, notes: sanitizeNotes({}), excel: { focus, backlog: backlogWeeks(tickets, week, { organizations: config.organizations, focus }), categories: categoryTables(tickets, week), trends } };
  const columns = [{ label: 'Key', type: 'text', width: 12 }, { label: 'Created', type: 'datetime', width: 17 }];
  const lists = {
    open: { columns, rows: [{ cells: ['SD-1', 46000.5], category: 'vPos Device' }] },
    created: { columns, rows: [{ cells: ['SD-4', 46335.4], category: 'Faulty/Replacement Hardware' }, { cells: ['SD-5', 46336.4], category: 'vPos Device ' }] },
  };
  const sheets = weeklySheets(record, lists);
  assert.deepEqual(sheets.map((s) => s.name), ['Backlog and Ticket Activity', 'Tickets by Category Breakdown', 'Trend Analysis by Overview', 'Open Tickets', '09.11-15.11',
    'vPOS Tickets 09.11-15.11', 'Hardware Tickets 09.11-15.11', 'Workload', 'Action register', 'Insights and progress']);
  const backlog = sheets[0].rows;
  assert.deepEqual(backlog[1].map((c) => c?.v ?? null), [null, '26.10-01.11', '02.11-08.11', '09.11-15.11']);
  assert.deepEqual(backlog[2].map((c) => c.v), ['Total Open Tickets', 2, 2, 4]);
  assert.deepEqual(backlog[2].map((c) => c.style), ['boxLabelBold', 'boxBold', 'boxBold', 'boxBold']);
  assert.ok(backlog.some((r) => r[0]?.v === 'Created – Ryanair Crew' && r[0].style === 'boxLabel'));
  assert.ok(backlog.some((r) => r[0]?.v === 'Created Hardware Tickets' && r[3].v === 2));
  // Created up 200% is worse (red); resolved down from 1 to 1 is no change; the first week has nothing to compare.
  const createdWow = backlog.find((r) => r[0]?.v === 'Created WoW %');
  assert.deepEqual(createdWow.slice(1).map((c) => [c.v, c.style]), [[null, 'boxPercent'], [0, 'boxPercent'], [200, 'boxBad']]);
  const cat = sheets[1];
  assert.equal(cat.rows[0][0].v, 'Open Tickets as of 15.11 by Module type');
  assert.equal(cat.rows[0][8].v, 'Created Tickets 09.11-15.11 by Module type');
  assert.deepEqual(cat.merges, ['A1:G1', 'I1:O1']);
  assert.ok(cat.rows.some((r) => r[3] === '    Battery'));
  assert.ok(cat.rows.some((r) => r[3]?.v === 'Faulty/Replacement Hardware' && r[6] === 'New'));
  const trend = sheets[2].rows;
  assert.equal(trend[0][0].v, 'Top 10 vPOS issues');
  assert.equal(trend[0][6].v, 'Top 10 Hardware issues');
  assert.equal(trend[2][4].v, 'Example: SD-5 — Master would not connect.');
  assert.match(trend[2][7].v, /could not be written.*busy/);
  assert.deepEqual(sheets[5].rows.map((r) => r[0]?.v ?? r[0]), ['Key', 'SD-5']);
  assert.equal(sheets[3].autoFilter, 'A1:B2');
  assert.deepEqual(sheets[3].rows[1][1], { v: 46000.5, style: 'datetime' });
  // Written out: frozen header, filter and its hidden name, merged titles.
  const files = unzip(workbook(sheets));
  assert.match(files['xl/worksheets/sheet4.xml'], /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/);
  assert.match(files['xl/worksheets/sheet4.xml'], /<autoFilter ref="A1:B2"\/>/);
  assert.match(files['xl/workbook.xml'], /<definedName name="_xlnm._FilterDatabase" localSheetId="3" hidden="1">'Open Tickets'!\$A\$1:\$B\$2<\/definedName>/);
  assert.match(files['xl/worksheets/sheet2.xml'], /<mergeCells count="2"><mergeCell ref="A1:G1"\/><mergeCell ref="I1:O1"\/><\/mergeCells>/);
  // Without the lists (or for weeks built before), no ticket sheets.
  assert.equal(weeklySheets(record).length, 6);
  assert.equal(weeklySheets(report).map((s) => s.name)[0], 'Key metrics');
});

test('comparison rows: the same figures and colours for the page, PDF and Excel', async () => {
  const { comparisonRows } = await import('../src/weekly.js');
  const { weeklyPdfContent } = await import('../src/weeklyPdf.js');
  const backlog = [
    { from: '2026-10-26', to: '2026-11-01', open: 10, created: 5, resolved: 4, resolvedPct: 20, avgOpenAgeDays: 30, createdChange: null, resolvedChange: null, createdByOrg: [], createdByFocus: [{ label: 'vPOS', count: 2 }] },
    { from: '2026-11-02', to: '2026-11-08', open: 12, created: 8, resolved: 3, resolvedPct: 15, avgOpenAgeDays: 31.5, createdChange: 60, resolvedChange: -25, createdByOrg: [], createdByFocus: [{ label: 'vPOS', count: 4 }] },
  ];
  const rows = comparisonRows(backlog);
  assert.deepEqual(rows.map((r) => r.label), ['Total Open Tickets', 'Created Tickets', 'Created vPOS Tickets', 'Total Resolved Tickets', '% tickets resolved', 'Average open ticket age (days)', 'Created WoW %', 'Resolved WoW %']);
  assert.deepEqual(rows.find((r) => r.label === 'Created WoW %').tones, [null, 'bad']);
  assert.deepEqual(rows.find((r) => r.label === 'Resolved WoW %').tones, [null, 'bad']);
  assert.deepEqual(comparisonRows([{ ...backlog[1], createdChange: -10, resolvedChange: 30 }]).slice(-2).map((r) => r.tones), [['good'], ['good']]);
  assert.deepEqual(comparisonRows(undefined), []);
  // The PDF puts it after Key metrics; weeks built before 1.39.0 leave it out.
  const record = { name: 'R', week: { from: '2026-11-02', to: '2026-11-08' }, organizations: [], fields: {}, activity: { all: { previous: {} }, byOrg: [] }, categories: null, workload: { totals: { resolved: 0 }, previous: {}, rows: [] }, notes: {} };
  const withTable = weeklyPdfContent({ ...record, excel: { backlog } }).sections;
  assert.equal(withTable[1].title, 'Backlog and ticket activity');
  const wow = withTable[1].tables[0].rows.find((r) => r.cells[0] === 'Created WoW %');
  assert.deepEqual(wow, { bold: undefined, tones: [null, null, 'bad'], cells: ['Created WoW %', '–', '+60%'] });
  assert.notEqual(weeklyPdfContent(record).sections[1]?.title, 'Backlog and ticket activity');
});
