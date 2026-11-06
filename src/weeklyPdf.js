// The Weekly SD report as PDF content (drawn by static/app/src/exportWeeklyPdf.js),
// for agents and portal customers alike. Same sections and wording as the page
// and the Excel workbook (src/weeklyExcel.js): key metrics, top issues,
// workload, insights, the action register and progress. Plain data, so it can
// be tested without a PDF library.
import { changeText, noteLines, weekLabel } from './weekly.js';
import { minutesText } from './agents.js';

const n = (value) => (value === null || value === undefined ? '–' : Number(value).toLocaleString('en-GB'));
const pct = (value) => (value === null || value === undefined ? '–' : `${value}%`);
const dec = (value) => (value === null || value === undefined ? '–' : (Math.round(Number(value) * 10) / 10).toLocaleString('en-GB'));

function metrics(record) {
  const scopes = [{ label: 'All', a: record.activity.all }, ...record.activity.byOrg.map((o) => ({ label: o.organization.name, a: o }))];
  const row = (label, read) => [label, ...scopes.map(({ a }) => read(a))];
  const a = record.activity.all;
  return {
    title: 'Key metrics',
    kpis: [
      { label: 'Open tickets', value: n(a.openEnd), hint: 'at the end of the week' },
      { label: 'Created last week', value: n(a.created), hint: `${changeText(a.createdChange)} on the week before` },
      { label: 'Resolved last week', value: n(a.resolved), hint: `${changeText(a.resolvedChange)} on the week before` },
      { label: '% tickets resolved', value: pct(a.resolvedPct), hint: `${changeText(a.resolvedPctChange, ' pts')} week on week` },
    ],
    tables: [{
      columns: [{ label: '', weight: 3 }, ...scopes.map((s) => ({ label: s.label, align: 'right', weight: 1.4 }))],
      rows: [
        row('Open tickets (end of week)', (x) => n(x.openEnd)),
        row('Open tickets (start of week)', (x) => n(x.openStart)),
        row('Created last week', (x) => n(x.created)),
        row('Resolved last week', (x) => n(x.resolved)),
        row('% tickets resolved last week', (x) => pct(x.resolvedPct)),
        row('% resolved the week before', (x) => pct(x.previous.resolvedPct)),
        row('% resolved week on week', (x) => changeText(x.resolvedPctChange, ' pts')),
        row('Created week on week', (x) => changeText(x.createdChange)),
        row('Resolved week on week', (x) => changeText(x.resolvedChange)),
      ],
    }],
    notes: ['% resolved = tickets resolved in the week ÷ (tickets open at the start of the week + tickets created in it).'],
  };
}

function breakdown(rows) {
  return {
    columns: [{ label: 'Name', weight: 3.5 }, { label: 'Tickets', align: 'right' }, { label: 'Share', align: 'right' }, { label: 'Week before', align: 'right', weight: 1.3 }, { label: 'Change', align: 'right' }],
    rows: [
      ...rows.map((r) => [r.name, n(r.count), pct(r.share), n(r.previous), r.change > 0 ? `+${r.change}` : String(r.change)]),
      { bold: true, cells: ['Total', n(rows.reduce((t, r) => t + r.count, 0)), '', n(rows.reduce((t, r) => t + r.previous, 0)), ''] },
    ],
  };
}

function issues(record) {
  if (!record.categories) return { title: 'Top issues', notes: ['No category field is set for this report.'] };
  const tables = [{ caption: `Tickets by ${record.fields.category || 'category'} (created last week)`, ...breakdown(record.categories) }];
  if (record.subcategories) tables.push({ caption: `${record.subcategories.category} by ${record.fields.subcategory || 'subcategory'}`, ...breakdown(record.subcategories.rows) });
  return { title: 'Top issues', tables };
}

function workload(record) {
  const w = record.workload;
  if (!w) return null;
  const line = (name, r, bold = false) => ({ bold, cells: [name, n(r.resolved), dec(r.handlingHours), minutesText(r.avgHandlingMinutes), r.share === undefined ? '' : pct(r.share), dec(r.statusChangesPerTicket), dec(r.reassignmentsPerTicket)] });
  return {
    title: 'Workload to resolve tickets',
    tables: [{
      columns: [{ label: 'Category', weight: 3 }, { label: 'Resolved', align: 'right' }, { label: 'Handling h', align: 'right' }, { label: 'Per ticket', align: 'right', weight: 1.2 }, { label: 'Share', align: 'right' }, { label: 'Status changes', align: 'right', weight: 1.3 }, { label: 'Reassigned', align: 'right' }],
      rows: [...w.rows.map((r) => line(r.name, r)), line('Total last week', w.totals, true), line('Total the week before', w.previous)],
    }],
    notes: [
      `Handling time is the time tickets spent in ${w.handlingStatuses ? w.handlingStatuses.join(', ') : 'in-progress statuses that aren’t waiting ones'}, for tickets resolved in the week. Status changes and reassignments are per ticket.`,
      ...(w.complete ? [] : [`History was read for ${w.totals.read} of ${w.totals.resolved} resolved tickets; averages use those.`]),
    ],
  };
}

function actions(record) {
  const list = record.notes?.actions || [];
  if (!list.length) return { title: 'Action register', notes: ['No actions recorded.'] };
  return {
    title: 'Action register',
    tables: [{
      columns: [{ label: 'Action', weight: 5 }, { label: 'Owner', weight: 1.6 }, { label: 'Due', weight: 1.1 }, { label: 'Status', weight: 1.1 }],
      rows: list.map((a) => [a.action, a.owner || '–', a.due || '–', a.status || 'Open']),
      wrap: true,
    }],
  };
}

function bullets(title, text) {
  const lines = noteLines(text);
  return { title, bullets: lines.length ? lines : null, notes: lines.length ? [] : ['–'] };
}

/** Everything the PDF draws for one week, in order. */
export function weeklyPdfContent(record) {
  const n2 = record.notes || {};
  return {
    title: record.name,
    subtitle: `Week ${weekLabel(record.week)} (Monday to Sunday, Irish time)`,
    organizations: record.organizations.map((o) => o.name).join(', '),
    built: record.builtAt ? new Date(record.builtAt).toLocaleString('en-IE', { timeZone: 'Europe/Dublin', dateStyle: 'medium', timeStyle: 'short' }) : '',
    sections: [
      metrics(record),
      issues(record),
      workload(record),
      bullets('Insights', n2.insights),
      actions(record),
      { title: 'Progress', groups: [bullets('Completed this week', n2.completed), bullets('In progress', n2.inProgress), bullets('Next steps', n2.nextSteps)] },
    ].filter(Boolean),
  };
}

export function weeklyPdfFileName(record) {
  return `${String(record.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'weekly-report'}-${record.week.from}.pdf`;
}
