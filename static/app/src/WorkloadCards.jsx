// Workload planning cards: where the effort goes (from the report), and flow,
// backlog and forecast (from the analyzeFlow resolver).
import React from 'react';
import { Card, EmptyState, Kpi, Loading, Notice } from '@retailinmotion/ui/react';
import { duration } from '../../../src/trend.js';
import { busiestHours, effortRows } from '../../../src/flow.js';

const n = (value) => Number(value || 0).toLocaleString();
const hoursText = (h) => (h >= 100 ? `${n(Math.round(h))} h` : `${Math.round(h * 10) / 10} h`);
const shortDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

export function EffortCard({ report, groups, nameOf }) {
  const effort = effortRows(groups, report);
  if (!effort.rows.length) return null;
  const logged = effort.basis === 'logged';
  const top = Math.max(1, ...effort.rows.map((r) => r.value));
  const approx = report.effort?.estimated ? '≈' : '';
  return <Card title="Where the effort goes"
    description={logged
      ? `Recurring issues ranked by time logged on their tickets. ${approx}${hoursText(report.effort.loggedHours)} logged in the period; ${report.effort.loggedShare}% of tickets have time logged.`
      : `Recurring issues ranked by tickets × typical time to resolve, a rough guide to time spent: only ${report.effort?.loggedShare || 0}% of tickets have time logged. Logging work on tickets makes this exact.`}>
    <div className="nq-table-wrap">
      <table className="nq-table ci-effort">
        <thead><tr><th>Issue</th><th className="ci-num">Tickets</th><th className="ci-num">{logged ? 'Logged' : 'Typical time to resolve'}</th><th>Share of {logged ? 'logged time' : 'ticket-hours'}</th></tr></thead>
        <tbody>{effort.rows.map((r) => <tr key={r.index}>
          <td>{nameOf(groups[r.index], r.index)}</td>
          <td className="ci-num">{r.estimated ? '≈' : ''}{n(r.count)}</td>
          <td className="ci-num">{logged ? `${approx}${hoursText(r.loggedHours)}` : r.typicalHours === null ? '–' : duration(r.typicalHours)}</td>
          <td><span className="ci-crew__rate"><span className="ci-meter"><i style={{ width: `${Math.max(2, (r.value / top) * 100)}%` }} /></span><strong>{r.share}%</strong></span></td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="nq-muted">The biggest rows are the best candidates for a problem ticket, automation or a knowledge base article.</p>
  </Card>;
}

function FlowChart({ points }) {
  const max = Math.max(1, ...points.flatMap((p) => [p.created, p.resolved]));
  const every = Math.max(1, Math.ceil(points.length / 10));
  return <div className="ci-flow" role="img" aria-label="Tickets created and resolved over time">
    {points.map((p, i) => <div className="ci-flow__slot" key={p.date} title={`${p.date}: ${p.created} created, ${p.resolved} resolved`}>
      <div className="ci-flow__bars">
        <i className="ci-flow__created" style={{ height: `${Math.max(2, (p.created / max) * 100)}%` }} />
        <i className="ci-flow__resolved" style={{ height: `${Math.max(2, (p.resolved / max) * 100)}%` }} />
      </div>
      <span>{i % every === 0 ? p.date.slice(5) : ''}</span>
    </div>)}
  </div>;
}

export function FlowCard({ flow, loading, error, timeOfDay }) {
  if (loading) return <Card title="Flow and workload"><Loading inline text="Counting created, resolved and open tickets…" /></Card>;
  if (error) return <Card title="Flow and workload"><Notice kind="error">{error}</Notice></Card>;
  if (!flow) return null;
  const { flow: f, backlog, forecast } = flow;
  const nextWeek = forecast?.weeks?.[0];
  const peaks = nextWeek && timeOfDay?.grid ? busiestHours(timeOfDay.grid, nextWeek.expected) : [];
  const ageTop = Math.max(1, ...(backlog?.ages || []).map((a) => a.count));
  return <Card title="Flow and workload" description="Tickets coming in against tickets resolved, the open backlog, and what to expect in the coming weeks.">
    {!flow.complete && <Notice>Some counts took too long and are missing. Try a shorter period.</Notice>}
    <div className="nq-kpis">
      <Kpi icon="↘" label="Created" value={n(f.created)} hint="in the period" />
      <Kpi icon="✓" kind="success" label="Resolved" value={n(f.resolved)} hint="in the period" />
      <Kpi icon="⇅" kind={f.net > 0 ? 'warning' : 'success'} label="Backlog change" value={`${f.net > 0 ? '+' : ''}${n(f.net)}`} hint={f.net > 0 ? 'more came in than were resolved' : 'resolved at least as many as came in'} />
      {backlog && <Kpi icon="▤" kind="info" label="Open now" value={n(backlog.open)} hint="not done, all dates" />}
    </div>
    {f.points.length > 1 && <>
      <FlowChart points={f.points} />
      <p className="nq-muted ci-flow__legend"><i className="ci-flow__created" /> Created <i className="ci-flow__resolved" /> Resolved</p>
    </>}
    <div className="nq-grid ci-split">
      {backlog && <div>
        <h3 className="ci-subhead">Open backlog by age</h3>
        <ol className="ci-values">{backlog.ages.map((a) => <li key={a.label}>
          <span className="ci-values__name">{a.label}</span>
          <span className="ci-meter"><i style={{ width: `${Math.max(2, (a.count / ageTop) * 100)}%` }} /></span>
          <span className="ci-values__count">{n(a.count)}</span>
          <span />
        </li>)}</ol>
      </div>}
      {forecast ? <div>
        <h3 className="ci-subhead">Expected tickets per week</h3>
        <ol className="ci-values">{forecast.weeks.map((w) => <li key={w.from}>
          <span className="ci-values__name">Week of {shortDate(w.from)}</span>
          <span className="nq-muted">{n(w.low)}–{n(w.high)}</span>
          <span className="ci-values__count">~{n(w.expected)}</span>
          <span />
        </li>)}</ol>
        <p className="nq-muted">From the last 12 weeks (average {n(forecast.average)} a week, {forecast.direction}{forecast.direction !== 'steady' ? ` by about ${n(Math.abs(forecast.trendPerWeek))} a week` : ''}). The range is how much a normal week varies.</p>
        {peaks.length > 0 && <p className="nq-muted">Busiest hours next week ({timeOfDay.timeZone}): {peaks.map((p) => `${p.label} ~${p.expected}`).join(' · ')} tickets an hour.</p>}
      </div> : <EmptyState compact title="Not enough history for a forecast yet." />}
    </div>
  </Card>;
}
