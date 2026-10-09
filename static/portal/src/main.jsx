// Customer portal: the service report(s) agents published for the viewer's
// organisation(s). The server only returns reports for organisations the
// viewer belongs to (src/portal.js), and every ticket shown is one shared
// with that organisation, which they can already open in the portal.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke, router, view } from '@forge/bridge';
import '@retailinmotion/ui/css';
import { enableTheme } from '@retailinmotion/ui/theme';
import { Button, Card, EmptyState, Kpi, Loading, Lozenge, Notice } from '@retailinmotion/ui/react';
import { duration, sparkPath, trendWord } from '../../../src/trend.js';
import { DAYS, hoursOf, peakWindow, windowText } from '../../../src/timeOfDay.js';
import { version } from '../../../package.json';
import CrewRates from '../../app/src/CrewRates.jsx';
import './styles.css';

enableTheme(view);

const longDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
const signed = (n) => `${n > 0 ? '+' : ''}${n}`;
const time = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
// Detail is built in the background just after publishing; older reports may never have it.
const preparing = (r) => !r.detailed && Date.now() - Date.parse(r.refreshedAt || r.publishedAt) < 30 * 60000;

function Trend({ pattern }) {
  if (!pattern.previousCount) return <Lozenge kind="discovery">New</Lozenge>;
  const change = pattern.count - pattern.previousCount;
  if (change > 0) return <Lozenge kind="warning">↑ {change}</Lozenge>;
  if (change < 0) return <Lozenge kind="success">↓ {Math.abs(change)}</Lozenge>;
  return <Lozenge>Steady</Lozenge>;
}

function Sparkline({ points }) {
  if (!points || points.length < 2) return <span />;
  const label = `Requests over the period: ${points.map((p) => p.count).join(', ')}`;
  return <svg className="cp-spark" viewBox="0 0 72 18" width={72} height={18} role="img" aria-label={label}>
    <title>{label}</title>
    <path d={sparkPath(points, 72, 18)} />
  </svg>;
}

/** Opens a request in the portal (a new tab), through Forge's router. */
function RequestLink({ ticket }) {
  if (!ticket.url) return <span className="cp-key">{ticket.key}</span>;
  return <a className="cp-key" href={ticket.url} target="_blank" rel="noreferrer" onClick={(e) => { e.preventDefault(); router.open(ticket.url); }}>{ticket.key}</a>;
}

const resolutionText = ({ medianHours, openShare }) => [
  medianHours !== null && medianHours !== undefined ? `usually resolved in ${duration(medianHours)}` : '',
  openShare ? `${openShare}% still open` : '',
].filter(Boolean).join(' · ');

function Chart({ points }) {
  const max = Math.max(1, ...points.map((p) => p.count));
  const every = Math.max(1, Math.ceil(points.length / 8));
  return <div className="cp-chart" role="img" aria-label="Requests over time">
    {points.map((p, i) => <div className="cp-chart__slot" key={p.date} title={`${p.date}: ${p.count}`}>
      <div className="cp-chart__bar" style={{ height: `${Math.max(4, (p.count / max) * 100)}%` }} />
      <span>{i % every === 0 ? new Date(`${p.date}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : ''}</span>
    </div>)}
  </div>;
}

/** Day-of-week × hour heatmap of when requests were raised. */
function TimeHeatmap({ grid }) {
  const max = Math.max(1, ...grid.flat());
  return <div className="cp-heat" role="img" aria-label="Requests by day of week and hour of day">
    <span />
    {Array.from({ length: 24 }, (_, h) => <span key={h} className="cp-heat__hour">{h % 3 === 0 ? String(h).padStart(2, '0') : ''}</span>)}
    {grid.map((row, d) => <React.Fragment key={DAYS[d]}>
      <span className="cp-heat__day">{DAYS[d]}</span>
      {row.map((n, h) => <span key={h} className="cp-heat__cell" title={`${DAYS[d]} ${String(h).padStart(2, '0')}:00`}>
        {n > 0 && <i style={{ opacity: 0.15 + 0.85 * (n / max) }} />}
      </span>)}
    </React.Fragment>)}
  </div>;
}

function WhenRequestsArrive({ timeOfDay }) {
  const { grid, timeZone } = timeOfDay;
  const total = grid.flat().reduce((a, n) => a + n, 0);
  if (!total) return null;
  const peak = peakWindow(hoursOf(grid));
  const dayTotals = grid.map((row) => row.reduce((a, n) => a + n, 0));
  const busiest = dayTotals.indexOf(Math.max(...dayTotals));
  return <Card title="When your requests arrive" description={`Times in ${timeZone}.`}>
    <div className="nq-kpis cp-when">
      {peak && <Kpi icon="◷" label="Busiest hours" value={windowText(peak)} hint={`${peak.share}% of requests`} />}
      <Kpi icon="▦" label="Busiest day" value={DAYS[busiest]} hint={`${Math.round((dayTotals[busiest] / total) * 100)}% of requests`} />
    </div>
    <TimeHeatmap grid={grid} />
  </Card>;
}

function Issue({ pattern }) {
  const word = trendWord(pattern.trend);
  const resolution = resolutionText(pattern);
  const peak = peakWindow(pattern.hours);
  const hasDetail = word || resolution || peak || pattern.examples?.length;
  const head = <>
    <span className="cp-issue__title">
      <strong>{pattern.title}</strong>
      {pattern.summary && <small className="nq-muted">{pattern.summary}</small>}
    </span>
    <Sparkline points={pattern.trend} />
    <span className="cp-issues__count">{pattern.estimated ? '≈' : ''}{pattern.count.toLocaleString()}</span>
    <Trend pattern={pattern} />
  </>;
  if (!hasDetail) return <li className="cp-issue"><div className="cp-issue__row">{head}<span /></div></li>;
  return <li className="cp-issue">
    <details>
      <summary className="cp-issue__row">{head}<span className="cp-issue__chevron" aria-hidden="true">›</span></summary>
      <div className="cp-issue__detail">
        {(word || resolution || peak) && <p className="nq-muted">{[word && `${word} through the period`, peak && `mostly ${windowText(peak)} (${peak.share}%)`, resolution].filter(Boolean).join(' · ')}</p>}
        {pattern.examples?.length > 0 && <>
          <p className="cp-label">Recent requests</p>
          <ul className="cp-examples">{pattern.examples.map((t) => <li key={t.key}>
            <RequestLink ticket={t} />
            <span className="cp-examples__summary">{t.summary}</span>
            <span className="nq-muted">{t.status}{t.created ? ` · ${new Date(t.created).toLocaleDateString()}` : ''}</span>
          </li>)}</ul>
        </>}
      </div>
    </details>
  </li>;
}

async function downloadPdf(report) {
  // Shares the agent page's PDF layout; jsPDF loads on first use.
  const { exportPortalPdf } = await import('../../app/src/exportPdf.js');
  await exportPortalPdf(report, { product: 'Customer Insights', version });
}

function Report({ report, onRefresh, refreshNote }) {
  const { totals } = report;
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfError, setPdfError] = useState('');
  async function pdf() {
    setPdfBusy(true); setPdfError('');
    try { await downloadPdf(report); } catch (error) { setPdfError(error.message || 'The PDF could not be created.'); } finally { setPdfBusy(false); }
  }
  const waitUntil = report.nextRefreshAt && report.nextRefreshAt > Date.now() ? report.nextRefreshAt : null;
  return <div className="nq-stack">
    <div className="nq-spread cp-title">
      <div>
        <h2 className="nq-card__title">{report.organization.name}</h2>
        <p className="nq-muted">{longDate(report.period.from)} – {longDate(report.period.to)}</p>
      </div>
      <div className="cp-updated">
        <span className="nq-muted">{report.live ? `Updated ${new Date(report.refreshedAt).toLocaleString()}` : `Published ${new Date(report.publishedAt).toLocaleDateString()}`}</span>
        <Button small onClick={pdf} disabled={pdfBusy}>{pdfBusy ? 'Preparing…' : 'Download PDF'}</Button>
        {report.live && <Button small onClick={onRefresh} disabled={report.refreshing || Boolean(waitUntil)}
          title={waitUntil ? `Available again at ${time(waitUntil)}` : undefined}>
          {report.refreshing ? 'Updating…' : 'Refresh'}
        </Button>}
      </div>
    </div>
    {refreshNote && <Notice>{refreshNote}</Notice>}
    {pdfError && <Notice kind="error">{pdfError}</Notice>}
    {preparing(report) && <Notice>We’re preparing the detail for this report (trends and example requests). It usually takes a minute or two.</Notice>}
    <div className="nq-kpis">
      <Kpi icon="▤" label="Requests" value={totals.current.toLocaleString()} hint="in this period" />
      <Kpi icon="↗" kind={totals.changePercent > 0 ? 'warning' : totals.changePercent < 0 ? 'success' : 'info'} label="Vs previous period"
        value={totals.changePercent === null ? '—' : `${signed(totals.changePercent)}%`} hint={`previous period: ${totals.previous.toLocaleString()}`} />
      {report.resolution && <Kpi icon="◷" kind="info" label="Typical time to resolve" value={duration(report.resolution.medianHours)}
        hint={report.resolution.openShare ? `${report.resolution.openShare}% still open` : 'all resolved'} />}
    </div>
    {report.timeSeries?.length > 1 && <Card title="Requests over time">
      <Chart points={report.timeSeries} />
    </Card>}
    {report.overview && <Card title="Summary" footer={report.live && <span className="nq-muted">Written {longDate(report.summaryWrittenAt.slice(0, 10))}. The numbers on this page are kept up to date.</span>}>
      <p className="cp-text">{report.overview}</p>
    </Card>}
    {report.patterns.length > 0 && <Card title="Most common issues" description={report.detailed ? 'Open an issue to see how it’s trending and recent requests.' : undefined}>
      <ol className="cp-issues">{report.patterns.map((p) => <Issue key={p.title} pattern={p} />)}</ol>
    </Card>}
    {report.timeOfDay && <WhenRequestsArrive timeOfDay={report.timeOfDay} />}
    {report.crewRates && <CrewRates rates={report.crewRates} approx={report.crewRates.estimated ? '≈' : ''} noun="requests" source="your crew list" />}
    {report.breakdowns?.length > 0 && <div className="nq-grid cp-breakdowns">{report.breakdowns.map((b) => {
      const top = Math.max(1, ...b.values.map((v) => v.count));
      return <Card key={b.label} title={`By ${b.label}`}>
        <ol className="cp-values">{b.values.map((v) => <li key={v.value}>
          <span className="cp-values__name" title={v.value}>{v.value}</span>
          <span className="cp-meter"><i style={{ width: `${Math.max(4, (v.count / top) * 100)}%` }} /></span>
          <span className="cp-issues__count">{b.estimated ? '≈' : ''}{v.count.toLocaleString()}</span>
        </li>)}</ol>
      </Card>;
    })}</div>}
    {report.actions.length > 0 && <Card title="Next steps">
      <ul className="cp-actions">{report.actions.map((a) => <li key={a}>{a}</li>)}</ul>
    </Card>}
    <p className="nq-muted cp-note">Issues are grouped from the wording of your organisation’s requests. Counts marked ≈ are estimates.</p>
  </div>;
}

const POLL_MS = 15000;
const POLL_FOR_MS = 5 * 60000;

function App() {
  const [state, setState] = useState({ loading: true });
  const [notes, setNotes] = useState({});
  const load = () => invoke('myReports')
    .then((result) => { setState({ loading: false, ...result }); return result; })
    .catch((error) => setState({ loading: false, error: error.message || 'The service report could not be loaded.' }));
  useEffect(() => { load(); }, []);

  // A just-published report fills in its detail in the background; check back until it has.
  useEffect(() => {
    if (!state.reports?.some(preparing)) return undefined;
    const timer = setTimeout(load, POLL_MS);
    return () => clearTimeout(timer);
  }, [state.reports]);

  async function refresh(report) {
    const orgId = report.organization.id;
    setNotes((n) => ({ ...n, [orgId]: '' }));
    try {
      const result = await invoke('refreshMyReport', { orgId });
      if (!result.queued) {
        setNotes((n) => ({ ...n, [orgId]: `This report was updated recently. You can refresh it again at ${time(result.nextRefreshAt)}.` }));
        return;
      }
      setNotes((n) => ({ ...n, [orgId]: 'Updating your report. This usually takes a minute or two; the page updates by itself.' }));
      const before = report.refreshedAt;
      const stopAt = Date.now() + POLL_FOR_MS;
      const poll = async () => {
        const latest = await load();
        const updated = latest?.reports?.find((r) => r.organization.id === orgId);
        if (updated && updated.refreshedAt !== before) { setNotes((n) => ({ ...n, [orgId]: '' })); return; }
        if (Date.now() < stopAt) setTimeout(poll, POLL_MS);
        else setNotes((n) => ({ ...n, [orgId]: 'The update is taking longer than usual. Check back shortly.' }));
      };
      setTimeout(poll, POLL_MS);
    } catch (error) {
      setNotes((n) => ({ ...n, [orgId]: error.message || 'The report could not be refreshed.' }));
    }
  }

  if (state.loading) return <div className="nq-page"><Loading text="Loading your service report…" /></div>;
  return <div className="nq-page nq-page--panel">
    {state.error && <Notice kind="error" title="Something went wrong.">{state.error}</Notice>}
    {!state.error && state.available === false && <Notice kind="warning">Service reports aren’t available on this site at the moment.</Notice>}
    {!state.error && state.available !== false && !state.reports?.length && <EmptyState title="No service report yet">
      Your service team hasn’t published a report for your organisation yet.
    </EmptyState>}
    {state.reports?.map((report) => <Report key={report.organization.id} report={report} onRefresh={() => refresh(report)} refreshNote={notes[report.organization.id]} />)}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
