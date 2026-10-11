// Workload planning cards: where the effort goes (from the report), and flow,
// backlog and forecast (from the analyzeFlow resolver).
import React from 'react';
import { Button, Card, EmptyState, Kpi, Loading, Lozenge, Notice } from '@retailinmotion/ui/react';
import { duration } from '../../../src/trend.js';
import { busiestHours, effortRows } from '../../../src/flow.js';
import { slaHotspots } from '../../../src/sla.js';

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

const pct = (value) => (value === null || value === undefined ? '–' : `${value}%`);

/** SLAs (settings → Internal → SLAs): met against breached, and where breaches cluster. */
export function SlaCard({ report, groups, nameOf }) {
  const [slaId, setSlaId] = React.useState(report.sla?.[0]?.id || '');
  if (!report.sla?.length) return null;
  const current = report.sla.find((s) => s.id === slaId) || report.sla[0];
  const hot = slaHotspots(report, groups, current.id);
  const approx = current.estimated ? '≈' : '';
  return <Card title="SLAs" description="Tickets that met or breached their SLA in the period. Rates for issues and breakdown values come from the analysed tickets."
    actions={report.sla.length > 1 && <select className="nq-select ci-crew__sort" aria-label="SLA" value={current.id} onChange={(e) => setSlaId(e.target.value)}>
      {report.sla.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>}>
    <div className="nq-kpis">
      {report.sla.map((s) => <Kpi key={s.id} icon="◷" kind={s.breachedShare >= 20 ? 'warning' : 'success'} label={s.name}
        value={pct(s.breachedShare === null ? null : 100 - s.breachedShare)} hint={`met · ${s.estimated ? '≈' : ''}${n(s.breached)} breached`} />)}
    </div>
    <div className="nq-grid ci-split">
      <div>
        <h3 className="ci-subhead">Recurring issues that breach most ({current.name})</h3>
        {hot.issues.length
          ? <ol className="ci-values">{hot.issues.map((r) => <li key={r.index}>
            <span className="ci-values__name" title={nameOf(groups[r.index], r.index)}>{nameOf(groups[r.index], r.index)}</span>
            <span className="nq-muted">{r.breached} of {r.met + r.breached}</span>
            <span className="ci-values__count">{pct(r.share)}</span>
            <span />
          </li>)}</ol>
          : <p className="nq-muted">No recurring issue has breached this SLA more than once or twice.</p>}
      </div>
      <div>
        {hot.breakdowns.length
          ? hot.breakdowns.map((b) => <div key={b.label}>
            <h3 className="ci-subhead">Highest breach rate by {b.label}</h3>
            <ol className="ci-values">{b.values.map((v) => <li key={v.value}>
              <span className="ci-values__name" title={v.value}>{v.value}</span>
              <span className="nq-muted">{v.breached} of {v.met + v.breached}</span>
              <span className="ci-values__count">{pct(v.share)}</span>
              <span />
            </li>)}</ol>
          </div>)
          : <p className="nq-muted">Add breakdown fields (such as team) to see where breaches cluster.</p>}
      </div>
    </div>
    {approx && <p className="nq-muted">Counts marked ≈ are estimated from the sample.</p>}
  </Card>;
}

/**
 * Knowledge gaps: searches the knowledge base for the top recurring issues on
 * request; issues with no matching article are candidates for one.
 */
export function KnowledgeCard({ groups, nameOf, invoke }) {
  const [state, setState] = React.useState({ loading: false, results: null, error: '' });
  const topics = (groups || []).slice(0, 15).map((g, index) => ({ key: g.id, title: nameOf(g, index), index }));
  if (!topics.length) return null;
  async function check() {
    setState({ loading: true, results: null, error: '' });
    try {
      const { results } = await invoke('knowledgeGaps', { topics: topics.map(({ key, title }) => ({ key, title })) });
      setState({ loading: false, results, error: '' });
    } catch (e) { setState({ loading: false, results: null, error: e.message || 'The knowledge base couldn’t be searched.' }); }
  }
  const byKey = new Map((state.results || []).map((r) => [r.key, r]));
  const gaps = topics.filter((t) => byKey.get(t.key) && !byKey.get(t.key).articles.length && !byKey.get(t.key).error);
  return <Card title="Knowledge gaps" description="Recurring issues with no knowledge base article are candidates for one: a good article lets customers and agents fix them faster."
    actions={<Button small onClick={check} disabled={state.loading}>{state.loading ? 'Searching…' : state.results ? 'Search again' : 'Check knowledge base'}</Button>}>
    {state.error && <Notice kind="error">{state.error}</Notice>}
    {state.loading && <Loading inline text={`Searching the knowledge base for ${topics.length} issues…`} />}
    {!state.results && !state.loading && !state.error && <p className="nq-muted">Searches the knowledge base for each of the top {topics.length} recurring issues.</p>}
    {state.results && <>
      <p className="nq-muted">{gaps.length ? `${gaps.length} of ${topics.length} issues have no matching article.` : 'Every issue has at least one possible article. Check they answer the issue.'}</p>
      <ul className="ci-gaps">{topics.map((t) => {
        const r = byKey.get(t.key);
        if (!r) return null;
        return <li key={t.key}>
          <span className="ci-gaps__name">{t.title} <span className="nq-muted">({n(groups[t.index].count)} tickets)</span></span>
          {r.error ? <span className="nq-muted">Not searched</span>
            : r.articles.length ? <span className="ci-gaps__articles">{r.articles.map((a, i) => <React.Fragment key={a.title + i}>{i > 0 && ' · '}{a.url ? <a href={a.url} target="_blank" rel="noreferrer">{a.title}</a> : a.title}</React.Fragment>)}</span>
            : <Lozenge kind="warning">No article</Lozenge>}
        </li>;
      })}</ul>
      <p className="nq-muted">Matches come from the knowledge base search for each issue’s main words, so check a match really covers the issue.</p>
    </>}
  </Card>;
}
