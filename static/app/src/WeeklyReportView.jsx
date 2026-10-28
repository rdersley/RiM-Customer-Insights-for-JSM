// One week of a Weekly SD report (src/weekly.js), read-only. Shared by the
// agent page and the customer portal, laid out as the customer asked: key
// metrics, top issues, insights, action register, then progress.
import React from 'react';
import { Card, EmptyState, Kpi, Lozenge, Notice } from '@retailinmotion/ui/react';
import { changeText, noteLines, weekLabel } from '../../../src/weekly.js';
import { minutesText } from '../../../src/agents.js';
import './weekly.css';

const n = (value) => (value === null || value === undefined ? '–' : Number(value).toLocaleString());
const pct = (value) => (value === null || value === undefined ? '–' : `${value}%`);

function Change({ value, unit = '%', higherIsBetter = false }) {
  if (value === null || value === undefined || value === 0) return <span className="nq-muted">{changeText(value, unit)}</span>;
  const good = higherIsBetter ? value > 0 : value < 0;
  return <Lozenge kind={good ? 'success' : 'warning'}>{changeText(value, unit)}</Lozenge>;
}

function Activity({ activity }) {
  const scopes = [{ label: 'All', a: activity.all }, ...activity.byOrg.map((o) => ({ label: o.organization.name, a: o }))];
  const a = activity.all;
  return <>
    <div className="nq-kpis">
      <Kpi icon="▤" label="Open tickets" value={n(a.openEnd)} hint="at the end of the week" />
      <Kpi icon="↘" label="Created last week" value={n(a.created)} hint={`${changeText(a.createdChange)} on the week before`} />
      <Kpi icon="✓" kind="success" label="Resolved last week" value={n(a.resolved)} hint={`${changeText(a.resolvedChange)} on the week before`} />
      <Kpi icon="%" kind={a.resolvedPctChange < 0 ? 'warning' : 'success'} label="% tickets resolved" value={pct(a.resolvedPct)} hint={`${changeText(a.resolvedPctChange, ' pts')} week on week`} />
    </div>
    <div className="nq-table-wrap">
      <table className="nq-table wk-table">
        <thead><tr><th>Backlog and ticket activity</th>{scopes.map((s) => <th key={s.label} className="wk-num">{s.label}</th>)}</tr></thead>
        <tbody>
          <tr><td>Open tickets total</td>{scopes.map((s) => <td key={s.label} className="wk-num">{n(s.a.openEnd)}</td>)}</tr>
          <tr><td>Created last week</td>{scopes.map((s) => <td key={s.label} className="wk-num">{n(s.a.created)}</td>)}</tr>
          <tr><td>Resolved last week</td>{scopes.map((s) => <td key={s.label} className="wk-num">{n(s.a.resolved)}</td>)}</tr>
          <tr><td>% tickets resolved last week</td>{scopes.map((s) => <td key={s.label} className="wk-num">{pct(s.a.resolvedPct)}</td>)}</tr>
          <tr><td>% tickets resolved week on week</td>{scopes.map((s) => <td key={s.label} className="wk-num"><Change value={s.a.resolvedPctChange} unit=" pts" higherIsBetter /></td>)}</tr>
        </tbody>
      </table>
    </div>
    <p className="nq-muted">Open tickets are those without a resolution at the end of Sunday. % resolved = resolved in the week ÷ (open at the start of the week + created in it); the week before it was {pct(a.previous.resolvedPct)} ({n(a.previous.resolved)} of {n(a.previous.openStart + a.previous.created)}).</p>
  </>;
}

function Breakdown({ rows }) {
  const top = Math.max(1, ...rows.map((r) => r.count));
  return <div className="nq-table-wrap">
    <table className="nq-table wk-table">
      <thead><tr><th>Name</th><th className="wk-bar" aria-hidden="true" /><th className="wk-num">Tickets</th><th className="wk-num">Share</th><th className="wk-num">Week before</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.name}>
        <td>{r.name}</td>
        <td className="wk-bar"><span className="wk-meter"><i style={{ width: `${Math.max(2, (r.count / top) * 100)}%` }} /></span></td>
        <td className="wk-num"><strong>{n(r.count)}</strong></td>
        <td className="wk-num">{pct(r.share)}</td>
        <td className="wk-num">{n(r.previous)} <span className="nq-muted">({r.change > 0 ? '+' : ''}{r.change})</span></td>
      </tr>)}</tbody>
    </table>
  </div>;
}

function Workload({ workload: w }) {
  if (!w.totals.resolved) return <EmptyState compact title="No tickets were resolved last week." />;
  return <>
    <div className="nq-kpis">
      <Kpi icon="⏱" label="Handling time" value={`${n(w.totals.handlingHours)} h`} hint={`${changeText(w.previous.handlingHours ? Math.round(((w.totals.handlingHours - w.previous.handlingHours) / w.previous.handlingHours) * 100) : null)} on the week before`} />
      <Kpi icon="◷" label="Per ticket resolved" value={minutesText(w.totals.avgHandlingMinutes)} hint={`was ${minutesText(w.previous.avgHandlingMinutes)}`} />
      <Kpi icon="⇄" label="Steps per ticket" value={n(w.totals.statusChangesPerTicket)} hint={`status changes; ${n(w.totals.reassignmentsPerTicket)} reassignments`} />
    </div>
    <div className="nq-table-wrap">
      <table className="nq-table wk-table">
        <thead><tr><th>Category</th><th className="wk-num">Resolved</th><th className="wk-num">Handling hours</th><th className="wk-num">Per ticket</th><th className="wk-num">Share of work</th><th className="wk-num">Steps / ticket</th></tr></thead>
        <tbody>{w.rows.map((r) => <tr key={r.name}>
          <td>{r.name}</td>
          <td className="wk-num">{n(r.resolved)}</td>
          <td className="wk-num">{n(r.handlingHours)}</td>
          <td className="wk-num">{minutesText(r.avgHandlingMinutes)}</td>
          <td className="wk-num"><strong>{pct(r.share)}</strong></td>
          <td className="wk-num">{n(r.statusChangesPerTicket)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="nq-muted">Handling time is the time resolved tickets spent being worked on ({w.handlingStatuses ? w.handlingStatuses.join(', ') : 'in-progress statuses, not waiting ones'}), from each ticket’s history. Steps are status changes; a category with more steps per ticket needed more back and forth.{!w.complete && ` History was read for ${n(w.totals.read)} of ${n(w.totals.resolved)} tickets.`}</p>
  </>;
}

function Lines({ text, empty }) {
  const lines = noteLines(text);
  return lines.length ? <ul className="wk-lines">{lines.map((l, i) => <li key={i}>{l}</li>)}</ul> : <p className="nq-muted">{empty}</p>;
}

/** `record` is a stored week; `hideNotes` leaves out the agent sections (while editing them). */
export default function WeeklyReportView({ record, hideNotes = false }) {
  const notes = record.notes || {};
  return <div className="wk-report">
    <p className="nq-muted">{record.organizations.map((o) => o.name).join(' · ')} · week {weekLabel(record.week)} (Monday to Sunday, Irish time)</p>

    <Card title="Key metrics">
      <Activity activity={record.activity} />
    </Card>

    <Card title="Top issues" description={`Tickets created last week${record.fields.category ? ` by ${record.fields.category}` : ''}.`}>
      {!record.categories ? <Notice>No category field is set for this report yet.</Notice>
        : record.categories.length ? <Breakdown rows={record.categories} /> : <EmptyState compact title="No tickets were created last week." />}
      {record.subcategories && <>
        <h3 className="wk-subhead">{record.subcategories.category} by {record.fields.subcategory || 'subcategory'}</h3>
        <Breakdown rows={record.subcategories.rows} />
      </>}
    </Card>

    <Card title="Workload to resolve tickets" description="How much work last week’s resolved tickets took, by category.">
      <Workload workload={record.workload} />
    </Card>

    {!hideNotes && <>
      <Card title="Insights"><Lines text={notes.insights} empty="No insights added." /></Card>
      <Card title="Action register">
        {notes.actions?.length ? <div className="nq-table-wrap">
          <table className="nq-table wk-table">
            <thead><tr><th>Action</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead>
            <tbody>{notes.actions.map((a, i) => <tr key={i}>
              <td>{a.action}</td><td>{a.owner || '–'}</td><td>{a.due || '–'}</td>
              <td><Lozenge kind={a.status === 'Done' ? 'success' : a.status === 'In progress' ? 'info' : a.status === 'On hold' ? 'warning' : 'neutral'}>{a.status}</Lozenge></td>
            </tr>)}</tbody>
          </table>
        </div> : <p className="nq-muted">No actions recorded.</p>}
      </Card>
      <Card title="Progress">
        <div className="nq-grid wk-progress">
          <div><h3 className="wk-subhead">Completed this week</h3><Lines text={notes.completed} empty="–" /></div>
          <div><h3 className="wk-subhead">In progress</h3><Lines text={notes.inProgress} empty="–" /></div>
          <div><h3 className="wk-subhead">Next steps</h3><Lines text={notes.nextSteps} empty="–" /></div>
        </div>
      </Card>
    </>}
  </div>;
}
