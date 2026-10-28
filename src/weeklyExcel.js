// The Weekly SD report as an Excel workbook (src/xlsx.js), for agents and
// portal customers alike: key metrics, top issues, workload, the action
// register and progress. Built in the browser from the stored week.
import { noteLines, weekLabel } from './weekly.js';
import { workbook } from './xlsx.js';

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

export function weeklySheets(record) {
  return [metricsSheet(record), issuesSheet(record), workloadSheet(record), actionsSheet(record), progressSheet(record)];
}

export function weeklyWorkbook(record) {
  return workbook(weeklySheets(record));
}

export function weeklyFileName(record) {
  return `${String(record.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'weekly-report'}-${record.week.from}.xlsx`;
}
