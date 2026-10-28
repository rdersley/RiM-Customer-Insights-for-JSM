import test from 'node:test';
import assert from 'node:assert/strict';
import { activityOf, changeText, lastWeek, noteLines, previousWeek, sanitizeNotes, sanitizeWeekly, stepsOf, weekLabel, weekOf, weeklyReport, weeklyTicket, workloadOf, zoneMidnight } from '../src/weekly.js';
import { readValues } from '../src/settings.js';
import { isWeeklyDue, queuedRecord, scopeJql } from '../src/weeklyJobs.js';
import { crc32, columnName, sheetName, workbook, zip } from '../src/xlsx.js';
import { weeklyFileName, weeklySheets } from '../src/weeklyExcel.js';

const at = (iso) => Date.parse(iso);

test('weeks run Monday to Sunday in Irish time, across clock changes', () => {
  // Wednesday 28 October 2026: last week is 19–25 October.
  const week = lastWeek(at('2026-10-28T10:00:00Z'));
  assert.equal(week.from, '2026-10-19');
  assert.equal(week.to, '2026-10-25');
  // Summer time (UTC+1) at the start, winter time (UTC) after the clocks went back on 25 October.
  assert.equal(new Date(week.start).toISOString(), '2026-10-18T23:00:00.000Z');
  assert.equal(new Date(week.end).toISOString(), '2026-10-26T00:00:00.000Z');
  // Monday just after midnight Irish time: the week that just ended.
  assert.equal(lastWeek(at('2026-10-26T00:30:00Z')).from, '2026-10-19');
  assert.equal(lastWeek(at('2026-10-25T23:30:00Z')).from, '2026-10-12');
  assert.equal(previousWeek(week).from, '2026-10-12');
  assert.equal(new Date(zoneMidnight('2026-01-05')).toISOString(), '2026-01-05T00:00:00.000Z');
  assert.equal(weekLabel(week), '19–25 October 2026');
  assert.equal(weekLabel(weekOf('2026-09-28')), '28 September–4 October 2026');
});

const week = weekOf('2026-10-19');
const before = previousWeek(week);
const t = (created, resolved = null, extra = {}) => ({ id: String(Math.random()), created: at(created), resolved: resolved ? at(resolved) : null, orgs: ['Ryanair'], category: 'Device', subcategory: null, logged: 0, ...extra });

test('% resolved is resolved ÷ (open at the start + created), from the open count now wound back', () => {
  const tickets = [
    t('2026-10-10T09:00:00Z', '2026-10-20T09:00:00Z'), // open at the start of the week, resolved in it
    t('2026-10-13T09:00:00Z'), // created the week before, still open
    t('2026-10-20T09:00:00Z', '2026-10-21T09:00:00Z'), // created and resolved in the week
    t('2026-10-22T09:00:00Z'), // created in the week, still open
    t('2026-10-27T09:00:00Z'), // created this week, still open
    t('2026-10-14T09:00:00Z', '2026-10-15T09:00:00Z'), // the week before
  ];
  // Open now: 3 above plus 7 older tickets.
  const a = activityOf(tickets, 10, week, before);
  assert.equal(a.created, 2);
  assert.equal(a.resolved, 2);
  assert.equal(a.openEnd, 9); // 10 now − 1 created since
  assert.equal(a.openStart, 9); // 9 + 2 resolved − 2 created
  assert.equal(a.resolvedPct, Math.round((2 / 11) * 1000) / 10);
  assert.equal(a.previous.created, 2);
  assert.equal(a.previous.resolved, 1);
  assert.equal(a.previous.openStart, 8);
  assert.equal(a.resolvedPctChange, Math.round((a.resolvedPct - a.previous.resolvedPct) * 10) / 10);
  assert.equal(a.createdChange, 0);
  assert.equal(a.resolvedChange, 100);
  assert.equal(activityOf(tickets, null, week, before).resolvedPct, null);
});

test('a ticket resolved late on Sunday in Irish time belongs to that week', () => {
  // 23:30 Irish (winter) time on Sunday 25 October = 23:30 UTC.
  const a = activityOf([t('2026-10-20T09:00:00Z', '2026-10-25T23:30:00Z')], 0, week, before);
  assert.equal(a.resolved, 1);
  // 23:30 UTC on Sunday 18 October is 00:30 Monday in Irish summer time: this week.
  assert.equal(activityOf([t('2026-10-18T23:30:00Z')], 1, week, before).created, 1);
});

test('tickets read from Jira: organisations, category and cascading subcategory', () => {
  const issue = { id: '1', key: 'SD-1', fields: { created: '2026-10-20T10:00:00.000+0100', resolutiondate: null, timespent: 1800, customfield_1: [{ name: 'Ryanair Crew' }], customfield_2: { value: 'Device', child: { value: 'vPOS' } } } };
  const ticket = weeklyTicket(issue, { orgFieldId: 'customfield_1', categoryField: { id: 'customfield_2', kind: 'cascading' }, subcategoryField: null, readValues });
  assert.deepEqual([ticket.orgs, ticket.category, ticket.subcategory, ticket.resolved, ticket.logged], [['Ryanair Crew'], 'Device', 'vPOS', null, 1800]);
  const plain = weeklyTicket({ id: '2', fields: { created: '2026-10-20T10:00:00Z', customfield_3: { value: 'Card reader' } } }, { orgFieldId: null, categoryField: { id: 'customfield_2', kind: 'option' }, subcategoryField: { id: 'customfield_3', kind: 'option' }, readValues });
  assert.deepEqual([plain.category, plain.subcategory], ['No category', 'Card reader']);
});

test('the report: totals and per organisation, categories and the biggest one by subcategory', () => {
  const config = { id: 'w-ryr', name: 'Ryanair weekly', organizations: [{ id: '1', name: 'Ryanair' }, { id: '2', name: 'Ryanair Crew' }], categoryField: { id: 'c', name: 'RYR Category', kind: 'option' }, subcategoryField: { id: 's', name: 'RYR Subcategory', kind: 'option' } };
  const tickets = [
    t('2026-10-20T09:00:00Z', null, { category: 'Device', subcategory: 'vPOS', orgs: ['Ryanair Crew'] }),
    t('2026-10-20T10:00:00Z', null, { category: 'Device', subcategory: 'Card reader', orgs: ['Ryanair Crew'] }),
    t('2026-10-21T10:00:00Z', null, { category: 'Device', subcategory: 'vPOS', orgs: ['Ryanair'] }),
    t('2026-10-21T11:00:00Z', null, { category: 'Login', orgs: ['Ryanair'] }),
    t('2026-10-13T11:00:00Z', null, { category: 'Login', orgs: ['Ryanair'] }),
  ];
  const r = weeklyReport({ config, week, tickets, openNow: { all: 30, byOrg: { Ryanair: 20, 'Ryanair Crew': 10 } }, builtAt: '2026-10-26T01:00:00Z' });
  assert.equal(r.activity.all.created, 4);
  assert.deepEqual(r.activity.byOrg.map((o) => [o.organization.name, o.created, o.openEnd]), [['Ryanair', 2, 20], ['Ryanair Crew', 2, 10]]);
  assert.deepEqual(r.categories.map((c) => [c.name, c.count, c.share, c.previous, c.change]), [['Device', 3, 75, 0, 3], ['Login', 1, 25, 1, 0]]);
  assert.equal(r.subcategories.category, 'Device');
  assert.deepEqual(r.subcategories.rows.map((c) => [c.name, c.count]), [['vPOS', 2], ['Card reader', 1]]);
  assert.deepEqual(r.week, { from: '2026-10-19', to: '2026-10-25' });
  // One organisation: no per-organisation split, and no subcategories without a field.
  const one = weeklyReport({ config: { ...config, organizations: [config.organizations[0]], subcategoryField: null }, week, tickets, openNow: { all: 3 } });
  assert.deepEqual(one.activity.byOrg, []);
  assert.equal(one.subcategories, null);
});

test('workload: handling time, steps and logged work per category for tickets resolved in the week', () => {
  const tickets = [
    t('2026-10-15T09:00:00Z', '2026-10-20T09:00:00Z', { id: 'a', category: 'Device', logged: 3600 }),
    t('2026-10-19T09:00:00Z', '2026-10-21T09:00:00Z', { id: 'b', category: 'Device' }),
    t('2026-10-19T09:00:00Z', '2026-10-22T09:00:00Z', { id: 'c', category: 'Login' }),
    t('2026-10-12T09:00:00Z', '2026-10-13T09:00:00Z', { id: 'd', category: 'Login' }),
  ];
  const effort = {
    a: { handlingMs: 2 * 3600000, statusChanges: 4, reassignments: 1 },
    b: { handlingMs: 3600000, statusChanges: 2, reassignments: 0 },
    d: { handlingMs: 1800000, statusChanges: 2, reassignments: 0 },
  };
  const w = workloadOf(tickets, effort, week, before);
  assert.deepEqual(w.totals, { resolved: 3, read: 2, handlingHours: 3, avgHandlingMinutes: 90, statusChangesPerTicket: 3, reassignmentsPerTicket: 0.5, loggedHours: 1 });
  assert.equal(w.complete, false);
  assert.deepEqual(w.rows.map((r) => [r.name, r.resolved, r.handlingHours, r.share]), [['Device', 2, 3, 100], ['Login', 1, 0, 0]]);
  assert.equal(w.previous.handlingHours, 0.5);
  assert.deepEqual(stepsOf([{ items: [{ field: 'status' }, { fieldId: 'assignee', from: null }] }, { items: [{ fieldId: 'assignee', from: 'x' }, { field: 'status' }] }]), { statusChanges: 2, reassignments: 1 });
});

test('settings keep only visible organisations and supported fields', () => {
  const orgs = [{ id: '1', name: 'Ryanair' }, { id: '2', name: 'Ryanair Crew' }];
  const fields = [{ id: 'customfield_1', name: 'RYR Category', kind: 'cascading' }, { id: 'customfield_2', name: 'Sub', kind: 'option' }];
  const { reports } = sanitizeWeekly({ reports: [
    { id: 'w-ryr01', name: '  Ryanair weekly  ', organizations: [{ id: '1' }, { id: '2' }, { id: '9' }, { id: '1' }], projects: 'sd, hw, 1x', categoryField: { id: 'customfield_1' }, subcategoryField: { id: 'customfield_1' }, portal: true },
    { name: 'No orgs', organizations: [{ id: '9' }] },
    { name: '', organizations: [{ id: '1' }] },
  ] }, orgs, fields);
  assert.equal(reports.length, 1);
  assert.deepEqual(reports[0], { id: 'w-ryr01', name: 'Ryanair weekly', organizations: orgs, projects: ['SD', 'HW'], categoryField: { id: 'customfield_1', name: 'RYR Category', kind: 'cascading' }, subcategoryField: null, portal: true });
  assert.match(sanitizeWeekly({ reports: [{ name: 'X', organizations: [{ id: '1' }] }] }, orgs, fields).reports[0].id, /^w-[a-z0-9]+$/);
});

test('notes are trimmed, actions validated and lines made into bullets', () => {
  const notes = sanitizeNotes({ insights: 'a\r\n\r\n\r\n\r\nb', actions: [{ action: ' Replace readers ', owner: 'Ops', status: 'Done' }, { action: '' }, { action: 'Chase', status: 'Weird' }], completed: 'x'.repeat(5000) });
  assert.equal(notes.insights, 'a\n\nb');
  assert.deepEqual(notes.actions, [{ action: 'Replace readers', owner: 'Ops', due: '', status: 'Done' }, { action: 'Chase', owner: '', due: '', status: 'Open' }]);
  assert.equal(notes.completed.length, 4000);
  assert.deepEqual(noteLines('- one\n\n2) two\n• three'), ['one', 'two', 'three']);
  assert.equal(changeText(-3.5, ' pts'), '−3.5 pts');
  assert.equal(changeText(null), '–');
});

test('jobs: scope JQL, when a week is due, and the queued record keeps notes', () => {
  const config = { id: 'w-a', name: 'A', organizations: [{ id: '1', name: 'Ryanair' }, { id: '2', name: 'Ryanair "Crew"' }], projects: ['SD'] };
  assert.equal(scopeJql(config), 'organizations in ("Ryanair", "Ryanair \\"Crew\\"") AND project in (\'SD\')');
  assert.equal(scopeJql({ ...config, projects: [] }, [config.organizations[0]]), 'organizations = "Ryanair"');
  const now = at('2026-10-26T06:00:00Z');
  assert.equal(isWeeklyDue(null, now), true);
  assert.equal(isWeeklyDue({ builtAt: 'x' }, now), false);
  assert.equal(isWeeklyDue({ queuedAt: '2026-10-26T05:30:00Z' }, now), false);
  assert.equal(isWeeklyDue({ queuedAt: '2026-10-26T04:00:00Z' }, now), true);
  assert.equal(isWeeklyDue({ lastErrorAt: '2026-10-26T04:00:00Z' }, now), false);
  const notes = { insights: 'kept' };
  assert.deepEqual(queuedRecord(config, week, { notes, publishedAt: 'p' }, 'q'), { notes, publishedAt: 'p', id: 'w-a', name: 'A', week: { from: '2026-10-19', to: '2026-10-25' }, queuedAt: 'q' });
});

/** Reads a stored zip back: { path: text }, checking each entry's CRC. */
function unzip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = {};
  let at2 = 0;
  while (view.getUint32(at2, true) === 0x04034B50) {
    const crc = view.getUint32(at2 + 14, true);
    const size = view.getUint32(at2 + 18, true);
    const nameLength = view.getUint16(at2 + 26, true);
    const name = new TextDecoder().decode(bytes.slice(at2 + 30, at2 + 30 + nameLength));
    const data = bytes.slice(at2 + 30 + nameLength, at2 + 30 + nameLength + size);
    assert.equal(crc32(data), crc, `CRC of ${name}`);
    out[name] = new TextDecoder().decode(data);
    at2 += 30 + nameLength + size;
  }
  assert.equal(view.getUint32(bytes.length - 22, true), 0x06054B50);
  assert.equal(view.getUint16(bytes.length - 12, true), Object.keys(out).length);
  return out;
}

test('xlsx: a valid stored zip with sheets, styles and escaped text', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
  assert.deepEqual([0, 25, 26, 701].map(columnName), ['A', 'Z', 'AA', 'ZZ']);
  const used = new Set();
  assert.deepEqual([sheetName('Top issues: RYR/Crew', used), sheetName('top issues  ryr crew', used)], ['Top issues  RYR Crew', 'top issues  ryr crew 2']);
  const files = unzip(workbook([{ name: 'Data', columns: [20], rows: [[{ v: 'Name', style: 'bold' }, 'A & <B>'], ['Share', { v: 42.5, style: 'percent' }], [null, 3]] }]));
  assert.deepEqual(Object.keys(files), ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml']);
  const sheet = files['xl/worksheets/sheet1.xml'];
  assert.match(sheet, /<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Name<\/t><\/is><\/c>/);
  assert.match(sheet, /A &amp; &lt;B&gt;/);
  assert.match(sheet, /<c r="B2" s="3"><v>0.425<\/v><\/c>/);
  assert.match(sheet, /<row r="3"><c r="B3"><v>3<\/v><\/c><\/row>/);
  assert.match(files['xl/workbook.xml'], /<sheet name="Data" sheetId="1" r:id="rId1"\/>/);
  assert.equal(zip([['a.txt', 'é']])[30 + 5], 0xC3); // UTF-8 content
});

test('the weekly workbook has the five sheets and a file name per week', () => {
  const config = { id: 'w-ryr', name: 'Ryanair weekly', organizations: [{ id: '1', name: 'Ryanair' }, { id: '2', name: 'Ryanair Crew' }], categoryField: { id: 'c', name: 'RYR Category', kind: 'option' }, subcategoryField: null };
  const record = { ...weeklyReport({ config, week, tickets: [t('2026-10-20T09:00:00Z', null, { orgs: ['Ryanair Crew'] })], openNow: { all: 5, byOrg: { Ryanair: 2, 'Ryanair Crew': 3 } }, builtAt: '2026-10-26T01:00:00Z' }), notes: sanitizeNotes({ insights: '- Device tickets up\n- Login steady', actions: [{ action: 'Swap readers', owner: 'RiM', due: '30 Oct' }] }) };
  const sheets = weeklySheets(record);
  assert.deepEqual(sheets.map((s) => s.name), ['Key metrics', 'Top issues', 'Workload', 'Action register', 'Insights and progress']);
  const metrics = sheets[0].rows;
  assert.deepEqual(metrics[4].map((c) => c?.v ?? c), ['Backlog and ticket activity', 'All', 'Ryanair', 'Ryanair Crew']);
  assert.deepEqual(metrics[5], ['Open tickets (end of week)', 5, 2, 3]);
  assert.ok(sheets[4].rows.some((r) => r[0]?.v === 'Device tickets up'));
  assert.ok(sheets[3].rows.some((r) => r[0]?.v === 'Swap readers' && r[1] === 'RiM'));
  assert.equal(weeklyFileName(record), 'ryanair-weekly-2026-10-19.xlsx');
  assert.ok(unzip(workbook(sheets))['xl/worksheets/sheet5.xml'].includes('Login steady'));
});
