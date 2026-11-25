// The Weekly SD report as an Excel workbook (src/xlsx.js), for agents and
// portal customers alike. Weeks built with the Excel figures follow the
// Ryanair weekly workbook (backlog over three weeks, tickets by category, top
// issue trends, ticket lists); then workload, the action register and
// progress. Built in the browser from the stored week and, for the ticket
// lists, pages read from Jira (src/weeklyRows.js).
import { comparisonRows, noteLines, shortWeek, weekLabel } from './weekly.js';
import { columnName, workbook } from './xlsx.js';

const bold = (v) => ({ v, style: 'bold' });
const title = (v) => ({ v, style: 'title' });
const percent = (v) => (v === null || v === undefined ? null : { v, style: 'percent' });
const decimal = (v) => (v === null || v === undefined ? null : { v, style: 'decimal' });
const points = (v) => (v === null || v === undefined ? null : { v, style: 'decimal' });

const heading = (record, sheet) => [
  [title(`${record.name}: ${sheet}`)],
  [`Week ${weekLabel(record.week)} (Monday to Sunday, Irish time)`],
  [`Organisations: ${record.organizations.map((o) => o.name).join(', ')}`],
  [],
];

/** Key metrics: one column for everything, then one per organisation. */
function metricsSheet(record) {
  const scopes = [{ label: 'All', a: record.activity.all }, ...record.activity.byOrg.map((o) => ({ label: o.organization.name, a: o }))];
  const row = (label, read) => [label, ...scopes.map(({ a }) => read(a))];
  return {
    name: 'Key metrics',
    columns: [38, ...scopes.map(() => 18)],
    rows: [
      ...heading(record, 'key metrics'),
      [bold('Backlog and ticket activity'), ...scopes.map((s) => bold(s.label))],
      row('Open tickets (end of week)', (a) => a.openEnd),
      row('Open tickets (start of week)', (a) => a.openStart),
      row('Created last week', (a) => a.created),
      row('Resolved last week', (a) => a.resolved),
      row('% tickets resolved last week', (a) => percent(a.resolvedPct)),
      row('% tickets resolved the week before', (a) => percent(a.previous.resolvedPct)),
      row('% resolved week on week (change, points)', (a) => points(a.resolvedPctChange)),
      row('Created the week before', (a) => a.previous.created),
      row('Resolved the week before', (a) => a.previous.resolved),
      row('Created week on week', (a) => percent(a.createdChange)),
      row('Resolved week on week', (a) => percent(a.resolvedChange)),
      [],
      ['% resolved = tickets resolved in the week ÷ (tickets open at the start of the week + tickets created in it).'],
      [`Built ${new Date(record.builtAt).toLocaleString('en-IE', { timeZone: 'Europe/Dublin' })} (Irish time).`],
    ],
  };
}

function breakdownRows(rows) {
  return [
    [bold('Name'), bold('Tickets last week'), bold('Share'), bold('Week before'), bold('Change')],
    ...rows.map((r) => [r.name, r.count, percent(r.share), r.previous, r.change]),
    [bold('Total'), bold(rows.reduce((n, r) => n + r.count, 0)), null, bold(rows.reduce((n, r) => n + r.previous, 0))],
  ];
}

function issuesSheet(record) {
  const rows = [...heading(record, 'top issues')];
  if (!record.categories) rows.push(['No category field is set for this report (Customer Insights settings → Weekly report).']);
  else {
    rows.push([bold(`Tickets by ${record.fields.category || 'category'} (created last week)`)], ...breakdownRows(record.categories));
    if (record.subcategories) rows.push([], [bold(`${record.subcategories.category} by ${record.fields.subcategory || 'subcategory'}`)], ...breakdownRows(record.subcategories.rows));
  }
  return { name: 'Top issues', columns: [44, 18, 12, 14, 10], rows };
}

function workloadSheet(record) {
  const w = record.workload;
  const line = (name, r) => [name, r.resolved, decimal(r.handlingHours), r.avgHandlingMinutes, r.share === undefined ? null : percent(r.share), decimal(r.statusChangesPerTicket), decimal(r.reassignmentsPerTicket), decimal(r.loggedHours)];
  return {
    name: 'Workload',
    columns: [40, 12, 16, 20, 18, 22, 22, 14],
    rows: [
      ...heading(record, 'workload to resolve tickets'),
      [bold('Category'), bold('Resolved'), bold('Handling hours'), bold('Avg handling (min)'), bold('Share of handling'), bold('Status changes / ticket'), bold('Reassignments / ticket'), bold('Logged hours')],
      ...w.rows.map((r) => line(r.name, r)),
      [bold('Total last week'), ...line('', w.totals).slice(1).map((c) => (c === null ? null : { ...(typeof c === 'object' ? c : { v: c }), style: 'bold' }))],
      line('Total the week before', w.previous),
      [],
      [`Handling time is the time tickets spent in ${w.handlingStatuses ? w.handlingStatuses.join(', ') : 'in-progress statuses that aren’t waiting ones'}, from each ticket’s history, for tickets resolved in the week.`],
      ...(w.complete ? [] : [[`History was read for ${w.totals.read} of ${w.totals.resolved} resolved tickets; averages use those.`]]),
    ],
  };
}

function actionsSheet(record) {
  const actions = record.notes?.actions || [];
  return {
    name: 'Action register',
    columns: [60, 22, 14, 14],
    rows: [
      ...heading(record, 'action register'),
      [bold('Action'), bold('Owner'), bold('Due'), bold('Status')],
      ...(actions.length ? actions.map((a) => [{ v: a.action, style: 'wrap' }, a.owner, a.due, a.status]) : [['No actions recorded.']]),
    ],
  };
}

function progressSheet(record) {
  const n = record.notes || {};
  const section = (label, text) => [[bold(label)], ...(noteLines(text).length ? noteLines(text).map((l) => [{ v: l, style: 'wrap' }]) : [['–']]), []];
  return {
    name: 'Insights and progress',
    columns: [100],
    rows: [
      ...heading(record, 'insights and progress'),
      ...section('Insights', n.insights),
      ...section('Completed this week', n.completed),
      ...section('In progress', n.inProgress),
      ...section('Next steps', n.nextSteps),
    ],
  };
}

// ---- The Ryanair-style sheets (record.excel, from src/weeklyJobs.js) -------------

const header = (v) => ({ v, style: 'header' });
const boldPercent = (v) => (v === null || v === undefined ? null : { v, style: 'boldPercent' });
const ddmm = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

/** Backlog and ticket activity over the last three weeks, oldest first. */
function backlogSheet(record) {
  const weeks = record.excel.backlog;
  // A boxed table: shaded labels, week columns, week-on-week changes green (better) or red (worse).
  const value = (r, v, i) => {
    if (r.kind === 'change') return { v, style: r.tones?.[i] === 'good' ? 'boxGood' : r.tones?.[i] === 'bad' ? 'boxBad' : 'boxPercent' };
    return { v, style: r.kind === 'percent' ? 'boxPercent' : r.kind === 'decimal' ? 'boxDecimal' : r.bold ? 'boxBold' : 'box' };
  };
  return {
    name: 'Backlog and Ticket Activity',
    columns: [40, ...weeks.map(() => 14)],
    rows: [
      [title('Backlog and Ticket Activity')],
      [null, ...weeks.map((w) => ({ v: shortWeek(w), style: 'boxHeader' }))],
      ...comparisonRows(weeks).map((r) => [{ v: r.label, style: r.bold ? 'boxLabelBold' : 'boxLabel' }, ...r.values.map((v, i) => value(r, v, i))]),
      [],
      ['Week on week: green is better (fewer created, more resolved), red is worse.'],
      ['Open tickets: open at the end of each week (Sunday midnight, Irish time). Age: days from created to the end of the week, averaged over those tickets.'],
      ['% resolved = tickets resolved in the week ÷ (tickets open at the start of the week + tickets created in it).'],
    ],
  };
}

/** Columns side by side: each block is { width, rows }, with `gap` empty columns between. */
function sideBySide(blocks, gap = 1) {
  const height = Math.max(...blocks.map((b) => b.rows.length));
  const rows = [];
  for (let r = 0; r < height; r += 1) {
    const row = [];
    blocks.forEach((b, i) => {
      const cells = b.rows[r] || [];
      for (let c = 0; c < b.width; c += 1) row.push(cells[c] ?? null);
      if (i < blocks.length - 1) for (let g = 0; g < gap; g += 1) row.push(null);
    });
    rows.push(row);
  }
  return rows;
}

/** Week-on-week change as a percentage; "New" when there were none the week before. */
export const wowChange = (count, previous) => (previous > 0 ? Math.round(((count - previous) / previous) * 1000) / 10 : count > 0 ? 'New' : null);

/** Category totals: name and count, with a grand total. */
function totalsBlock(tree) {
  return {
    width: 2,
    rows: [
      [header('Category'), header('Tickets')],
      ...tree.filter((c) => c.count).map((c) => [c.name, c.count]),
      [bold('Grand Total'), bold(tree.reduce((n, c) => n + c.count, 0))],
    ],
  };
}

/** Categories with their subcategories, against last week (LW). */
function detailBlock(tree) {
  const line = (name, r, strong) => {
    const change = wowChange(r.count, r.previous);
    const pctCell = typeof change === 'number' ? (strong ? boldPercent : percent)(change) : change;
    return [strong ? bold(name) : name, strong ? bold(r.count) : r.count, strong ? bold(r.previous) : r.previous, pctCell];
  };
  const total = { count: tree.reduce((n, c) => n + c.count, 0), previous: tree.reduce((n, c) => n + c.previous, 0) };
  return {
    width: 4,
    rows: [
      [header('Category / subcategory'), header('Tickets'), header('LW'), header('WoW Change %')],
      ...tree.flatMap((c) => [line(c.name, c, true), ...c.children.map((s) => line(`    ${s.name}`, s, false))]),
      line('Grand Total', total, true),
    ],
  };
}

function categorySheet(record) {
  const field = record.fields.category || 'category';
  const { open, created } = record.excel.categories;
  const blocks = [totalsBlock(open), detailBlock(open), totalsBlock(created), detailBlock(created)];
  // Titles over the open half and the created half.
  const createdAt = blocks[0].width + 1 + blocks[1].width + 1;
  const end = createdAt + blocks[2].width + 1 + blocks[3].width - 1;
  const titleRow = [];
  titleRow[0] = title(`Open Tickets as of ${ddmm(record.week.to)} by ${field}`);
  titleRow[createdAt] = title(`Created Tickets ${shortWeek(record.week)} by ${field}`);
  return {
    name: 'Tickets by Category Breakdown',
    columns: [30, 10, 2, 40, 10, 10, 14, 2, 30, 10, 2, 40, 10, 10, 14],
    merges: [`A1:${columnName(createdAt - 2)}1`, `${columnName(createdAt)}1:${columnName(end)}1`],
    rows: [titleRow, [], ...sideBySide(blocks), [], ['LW: the same count a week earlier (open at the end of the week before; created in the week before).']],
  };
}

function trendBlock(group, week) {
  const rows = [
    [title(`Top 10 ${group.label} issues`)],
    [header('Rank'), header('Issue trend'), header('Number of tickets'), header('Devices affected'), header('Description / example')],
  ];
  if (group.error) rows.push([null, { v: `The AI trends could not be written this time (${group.error}). Rebuild the week to try again.`, style: 'wrap' }]);
  else if (!group.trends.length) rows.push([null, group.tickets ? 'No trends found.' : `No ${group.label} tickets created ${shortWeek(week)}.`]);
  for (const t of group.trends) {
    rows.push([{ v: t.rank, style: 'top' }, { v: t.title, style: 'wrap' }, { v: t.count, style: 'top' }, { v: t.devices, style: 'wrap' }, { v: t.example ? `Example: ${t.exampleKey} — ${t.example}` : t.exampleKey, style: 'wrap' }]);
  }
  if (group.sent && group.sent < group.tickets) rows.push([null, `From the newest ${group.sent} of ${group.tickets} tickets.`]);
  return { width: 5, rows };
}

function trendSheet(record) {
  const trends = record.excel.trends;
  const name = 'Trend Analysis by Overview';
  if (!trends) return { name, columns: [100], rows: [[title('Top issues by trend')], ['The issue trends are written by AI when the week is built. Turn on AI for this report in Customer Insights settings → Weekly report, then rebuild the week.']] };
  const groups = trends.groups.slice(0, 2);
  if (!groups.length) return { name, columns: [100], rows: [[title('Top issues by trend')], ['No tickets with a category were created this week.']] };
  return {
    name,
    columns: [6, 34, 11, 26, 70, 2, 6, 34, 11, 26, 70].slice(0, groups.length * 6 - 1),
    rows: [...sideBySide(groups.map((g) => trendBlock(g, record.week))), [], ['Grouped by AI from each ticket’s overview (the AI ticket summary) when the week was built. Counts are the tickets in each trend.']],
  };
}

/** A ticket list as a sheet: header row kept in view, filters on. */
function listSheet(name, list, rows) {
  const cell = (v, c) => {
    if (v === null || v === undefined || v === '') return null;
    if (c?.type === 'datetime') return { v, style: 'datetime' };
    if (c?.type === 'date') return { v, style: 'date' };
    return v;
  };
  return {
    name,
    columns: list.columns.map((c) => c.width || 16),
    freeze: 1,
    autoFilter: `A1:${columnName(list.columns.length - 1)}${rows.length + 1}`,
    rows: [list.columns.map((c) => header(c.label)), ...rows.map((r) => r.cells.map((v, i) => cell(v, list.columns[i])))],
  };
}

const sameName = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();

/**
 * The workbook's sheets. Weeks built with the Excel figures (record.excel) get
 * the Ryanair layout; `lists` ({ open, created }: { columns, rows }) adds the
 * ticket sheets. Weeks built before keep the earlier layout.
 */
export function weeklySheets(record, lists = null) {
  const rest = [workloadSheet(record), actionsSheet(record), progressSheet(record)];
  if (!record.excel) return [metricsSheet(record), issuesSheet(record), ...rest];
  const label = shortWeek(record.week);
  const listSheets = lists ? [
    listSheet('Open Tickets', lists.open, lists.open.rows),
    listSheet(label, lists.created, lists.created.rows),
    ...record.excel.focus.map((f) => listSheet(`${f.label} Tickets ${label}`, lists.created, lists.created.rows.filter((r) => sameName(r.category, f.name)))),
  ] : [];
  return [
    backlogSheet(record),
    record.excel.categories ? categorySheet(record) : issuesSheet(record),
    trendSheet(record),
    ...listSheets,
    ...rest,
  ];
}

export function weeklyWorkbook(record, lists = null) {
  return workbook(weeklySheets(record, lists));
}

export function weeklyFileName(record) {
  return `${String(record.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'weekly-report'}-${record.week.from}.xlsx`;
}
