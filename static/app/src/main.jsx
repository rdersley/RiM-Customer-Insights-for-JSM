import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke, router, view } from '@forge/bridge';
import '@retailinmotion/ui/css';
import { enableTheme } from '@retailinmotion/ui/theme';
import { AppHeader, Button, Card, EmptyState, Field, Footer, Kpi, Loading, Lozenge, Notice } from '@retailinmotion/ui/react';
import { version } from '../../../package.json';
import { localIso, matchPreset, presetRange, PRESETS } from '../../../src/dates.js';
import { analyseEveryTicket, Cancelled, FULL_LIMIT } from './fullAnalysis.js';
import { applyMerges, median, patternTrend, topShares } from '../../../src/analysis.js';
import { jqlClause, jqlEmptyClause } from '../../../src/settings.js';
import { changeText } from '../../../src/alertText.js';
import { duration, sparkPath, trendWord } from '../../../src/trend.js';
import { DAYS, hoursOf, outOfHoursShare, peakWindow, WORKING, windowText } from '../../../src/timeOfDay.js';

// The agent's own time zone, so "when tickets arrive" reads in local time.
const LOCAL_ZONE = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();

/** Day-of-week × hour heatmap; cell shade is the share of the busiest cell. */
function TimeHeatmap({ grid }) {
  const max = Math.max(1, ...grid.flat());
  return <div className="ci-heat" role="img" aria-label="Tickets by day of week and hour of day">
    <span />
    {Array.from({ length: 24 }, (_, h) => <span key={h} className="ci-heat__hour">{h % 3 === 0 ? String(h).padStart(2, '0') : ''}</span>)}
    {grid.map((row, d) => <React.Fragment key={DAYS[d]}>
      <span className="ci-heat__day">{DAYS[d]}</span>
      {row.map((n, h) => <span key={h} className="ci-heat__cell" title={`${DAYS[d]} ${String(h).padStart(2, '0')}:00 – ${n} ticket${n === 1 ? '' : 's'}`}>
        {n > 0 && <i style={{ opacity: 0.15 + 0.85 * (n / max) }} />}
      </span>)}
    </React.Fragment>)}
  </div>;
}
import './styles.css';

enableTheme(view);

const PRODUCT = 'Customer Insights';
const DEFAULT_RANGE = presetRange('last-30');
const presetLabel = (key) => PRESETS.find((p) => p.key === key)?.label || key;
const signed = (n) => `${n > 0 ? '+' : ''}${n}`;
const MAX_LINK_KEYS = 150; // keeps "Open in Jira" URLs a sensible length

const resolutionText = ({ medianHours, openShare }) => [
  medianHours !== null && medianHours !== undefined ? `median ${duration(medianHours)} to resolve` : 'none resolved yet',
  openShare ? `${openShare}% open` : '',
].filter(Boolean).join(' · ');

// More tickets than last period is the thing to look at, so rises are flagged.
function TrendLozenge({ group }) {
  if (!group.previousCount) return <Lozenge kind="discovery">New</Lozenge>;
  if (group.change > 0) return <Lozenge kind="warning">↑ {group.change}</Lozenge>;
  if (group.change < 0) return <Lozenge kind="success">↓ {Math.abs(group.change)}</Lozenge>;
  return <Lozenge>→ 0</Lozenge>;
}

/** A small line of a pattern's tickets per chart bucket. */
function Sparkline({ points, unit }) {
  if (!points || points.length < 2) return null;
  const label = `Tickets per ${unit}: ${points.map((p) => p.count).join(', ')}`;
  return <svg className="ci-spark" viewBox="0 0 72 18" width={72} height={18} role="img" aria-label={label}>
    <title>{label}</title>
    <path d={sparkPath(points, 72, 18)} />
  </svg>;
}

// Links out of the app go through Forge's router: a plain target="_blank" link
// in the app's iframe isn't reliable.
function JiraLink({ href, className, children }) {
  return <a className={className} href={href} target="_blank" rel="noreferrer" onClick={(e) => { e.preventDefault(); router.open(href); }}>{children}</a>;
}
function App() {
  const [orgs, setOrgs] = useState([]);
  const [orgIds, setOrgIds] = useState([]); // selected organisations; the first is the main one
  const [from, setFrom] = useState(DEFAULT_RANGE.from);
  const [to, setTo] = useState(DEFAULT_RANGE.to);
  const [lastQuery, setLastQuery] = useState(null);
  const [fullRun, setFullRun] = useState(null); // { fetched, total, phase } while running
  const [fullError, setFullError] = useState('');
  const cancelFull = useRef(false);
  const [publication, setPublication] = useState(null); // { canPublish, published } for the report's organisation
  const [draft, setDraft] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');
  const preset = matchPreset(from, to);
  const today = localIso(new Date());
  const [projectsText, setProjectsText] = useState('');
  const [report, setReport] = useState(null);
  const [loadingOrgs, setLoadingOrgs] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  const [error, setError] = useState('');
  const [queryOpen, setQueryOpen] = useState(false);
  const [licensed, setLicensed] = useState(true);
  const [ai, setAi] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');
  const [aiStep, setAiStep] = useState('');
  const [filter, setFilter] = useState(null); // drill-down: { id, label, value }
  const [siteUrl, setSiteUrl] = useState('');
  const [alerts, setAlerts] = useState([]);
  const [pendingRun, setPendingRun] = useState(null);

  useEffect(() => {
    view.getContext().then((context) => setSiteUrl(String(context?.siteUrl || '').replace(/\/$/, ''))).catch(() => {});
  }, []);
  // After "Summarise with AI", patterns are the AI-merged list; before, the rule-based one.
  const groups = ai?.groups || report?.groups || [];

  useEffect(() => {
    invoke('getOrganizations').then((result) => {
      const list = result?.organizations || [];
      setLicensed(result?.licensed !== false);
      setOrgs(list);
      if (list.length) setOrgIds([String(list[0].id)]);
      if (result?.licensed !== false) invoke('getAlerts').then((a) => setAlerts(a?.alerts || [])).catch(() => {});
    }).catch((e) => setError(e.message || 'Could not load customer organisations.'))
      .finally(() => setLoadingOrgs(false));
  }, []);

  // "Analyse" on an alert fills in the form; the run starts once the choices apply.
  useEffect(() => {
    if (pendingRun && orgIds.length === 1 && orgIds[0] === pendingRun.orgId && from === pendingRun.from && to === pendingRun.to) {
      setPendingRun(null);
      runAnalysis();
    }
  });

  function analyseAlert(alert) {
    if (!orgs.some((o) => o.id === alert.organization.id)) return;
    setOrgIds([alert.organization.id]); setFrom(alert.window.from); setTo(alert.window.to); setProjectsText('');
    setPendingRun({ orgId: alert.organization.id, from: alert.window.from, to: alert.window.to });
  }

  async function dismissAlert(alert) {
    setAlerts((list) => list.filter((a) => a.id !== alert.id));
    try { await invoke('dismissAlert', { id: alert.id }); } catch (e) { setError(e.message || 'The alert couldn’t be dismissed.'); }
  }

  const selectedOrgs = orgIds.map((id) => orgs.find((org) => org.id === id)).filter(Boolean);
  const selectedOrg = selectedOrgs[0];
  const MAX_ORGS = 10;
  const orgLabel = selectedOrgs.length > 1 ? `${selectedOrgs.length} organisations` : selectedOrg?.name;
  const projects = projectsText.split(/[\s,]+/).map((x) => x.trim().toUpperCase()).filter(Boolean);
  const maxGroup = Math.max(1, ...(report?.groups || []).map((g) => g.count));
  const graphMax = Math.max(1, ...(report?.timeSeries || []).map((p) => p.count));
  const labelEvery = Math.max(1, Math.ceil((report?.timeSeries?.length || 0) / 10));
  const totalChange = report?.changePercent === null ? 'New baseline' : `${signed(report?.changePercent)}%`;

  async function runAnalysis(event, nextFilter = null) {
    event?.preventDefault?.();
    if (!selectedOrg) return;
    setFilter(nextFilter);
    cancelFull.current = true;
    setLoadingReport(true); setError(''); setReport(null); setAi(null); setAiError(''); setFullRun(null); setFullError('');
    const query = { organization: selectedOrg, organizations: selectedOrgs, startDate: from, endDate: to, projects, timeZone: LOCAL_ZONE, ...(nextFilter && { filter: { id: nextFilter.id, value: nextFilter.value } }) };
    try {
      const result = await invoke('analyze', query);
      setReport(result);
      setLastQuery(query);
    } catch (e) { setError(e.message || 'Analysis failed. Check your Jira access and filters.'); }
    finally { setLoadingReport(false); }
  }

  async function runFull() {
    cancelFull.current = false;
    setFullError('');
    setFullRun({ fetched: 0, total: report.currentCount + report.previousCount, phase: 'fetching' });
    try {
      const full = await analyseEveryTicket({
        query: lastQuery,
        sampled: report,
        onProgress: (fetched, total, phase) => setFullRun({ fetched, total, phase }),
        isCancelled: () => cancelFull.current,
      });
      if (cancelFull.current) return;
      setReport(full); setAi(null); setAiError('');
    } catch (e) {
      if (!(e instanceof Cancelled)) setFullError(e.message || 'The full analysis failed.');
    } finally { setFullRun(null); }
  }

  // Portal reports are for one organisation, so publishing needs a single-organisation analysis.
  const reportOrgId = lastQuery?.organizations?.length > 1 ? null : lastQuery?.organization?.id;
  useEffect(() => {
    setPublication(null); setDraft(null); setPublishError('');
    if (!report || !reportOrgId) return;
    invoke('getPublication', { orgId: reportOrgId }).then(setPublication).catch((e) => setPublishError(e.message || 'Could not check the portal report.'));
  }, [report?.organization, report?.startDate, report?.endDate, reportOrgId]);

  function prepareDraft() {
    setPublishError('');
    setDraft({
      patterns: groups.slice(0, 12).map((g, index) => ({
        include: index < 8 && aiPattern(index)?.coherent !== false,
        title: aiPattern(index)?.title || g.theme,
        summary: aiPattern(index)?.summary || '',
        count: g.count,
        previousCount: g.previousCount,
        estimated: Boolean(g.estimated),
      })),
      overview: ai?.overview || '',
      actions: (ai?.actions || []).join('\n'),
      live: publication?.published?.live || { schedule: 'weekly', preset: 'last-30' },
    });
  }

  async function refreshLive() {
    setPublishError('');
    try {
      const liveState = await invoke('refreshLiveReport', { orgId: reportOrgId });
      setPublication((p) => ({ ...p, liveState }));
    } catch (e) { setPublishError(e.message || 'The refresh could not be queued.'); }
  }

  const editPattern = (index, change) => setDraft((d) => ({ ...d, patterns: d.patterns.map((p, i) => (i === index ? { ...p, ...change } : p)) }));

  async function publish() {
    setPublishing(true); setPublishError('');
    try {
      const published = await invoke('publishReport', {
        snapshot: {
          organization: { id: reportOrgId },
          period: { from: report.startDate, to: report.endDate },
          totals: { current: report.currentCount, previous: report.previousCount },
          timeSeries: report.timeSeries,
          patterns: draft.patterns.filter((p) => p.include),
          overview: draft.overview,
          actions: draft.actions.split('\n'),
        },
        live: draft.live,
        projects: lastQuery?.projects || [],
      });
      setPublication((p) => ({ ...p, published, liveState: published.live ? { ...p?.liveState, queuedAt: new Date().toISOString() } : {} })); setDraft(null);
    } catch (e) { setPublishError(e.message || 'Publishing failed.'); }
    finally { setPublishing(false); }
  }

  async function unpublish() {
    setPublishing(true); setPublishError('');
    try {
      await invoke('unpublishReport', { orgId: reportOrgId });
      setPublication((p) => ({ ...p, published: null }));
    } catch (e) { setPublishError(e.message || 'Removing the report failed.'); }
    finally { setPublishing(false); }
  }

  function choosePreset(key) {
    const range = presetRange(key);
    if (range) { setFrom(range.from); setTo(range.to); }
  }

  // Two calls, each inside Forge's 25s limit: merge same-issue groups, then name and summarise.
  async function runAi() {
    setAiLoading(true); setAiError('');
    try {
      setAiStep('merge');
      let merged = report.groups;
      let mergedIssues = 0;
      try {
        const { merges } = await invoke('aiMerge', { report });
        merged = applyMerges(report.groups, merges);
        mergedIssues = merges.filter((m) => m.members.length > 1).length;
      } catch (e) {
        setAiError(`Similar patterns couldn’t be merged (${e.message || 'AI error'}); the summary uses the patterns as found.`);
      }
      setAiStep('summary');
      const summary = await invoke('aiSummary', { report: { ...report, groups: merged } });
      setAi({ ...summary, groups: merged, mergedIssues, mergedGroups: report.groups.length - merged.length });
    } catch (e) { setAiError(e.message || 'The AI summary could not be created.'); }
    finally { setAiLoading(false); setAiStep(''); }
  }

  // AI names apply to the first merged patterns (aiInput sends 12); the index is the merged order.
  const aiPattern = (index) => ai?.patterns.find((p) => p.index === index);
  const patternName = (group, index) => aiPattern(index)?.title || group.theme;
  // "Base: STN 38%, DUB 20% · Device type: vPOS 90%"
  const whereOf = (group) => (report?.breakdownFields || [])
    .map((f) => {
      const shares = topShares(group, f.id, 2);
      return shares.length ? `${f.label}: ${shares.map((s) => `${s.value} ${s.share}%`).join(', ')}` : '';
    })
    .filter(Boolean)
    .join(' · ');

  function exportCsv() {
    if (!report) return;
    const rows = [['Customer', report.organization], ['Period', `${report.startDate} to ${report.endDate}`]];
    if (ai?.overview) rows.push(['AI overview', ai.overview]);
    rows.push([], ['Pattern', 'AI name', 'Ticket count', 'Previous period', 'Change', 'Trend', 'Example ticket']);
    groups.forEach((group, index) => rows.push([group.theme, aiPattern(index)?.title || '', group.count, group.previousCount, group.changePercent === null ? 'New' : `${group.changePercent}%`, trendWord(patternTrend(group, report)), group.tickets[0]?.key || '']));
    if (report.timeOfDay) {
      rows.push([], [`Tickets by hour (${report.timeOfDay.timeZone})`, ...DAYS]);
      for (let h = 0; h < 24; h += 1) rows.push([`${String(h).padStart(2, '0')}:00`, ...report.timeOfDay.grid.map((row) => row[h])]);
    }
    rows.push([], ['Date bucket', 'Tickets']);
    for (const point of report.timeSeries) rows.push([point.date, point.count]);
    if (qualityIssues.length) {
      rows.push([], ['Data quality: field', 'Tickets with no real value', 'Share', 'No value', 'Placeholders']);
      for (const d of qualityIssues) rows.push([d.label, d.problemCount, `${d.share}%`, d.missing, d.placeholders.map((p) => `${p.value} (${p.count})`).join('; ')]);
    }
    const csv = rows.map((r) => r.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')).join('\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    link.download = `customer-insights-${(selectedOrgs.length > 1 ? `${selectedOrgs.length}-organisations` : selectedOrg.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${from}-${to}.csv`;
    link.click(); URL.revokeObjectURL(link.href);
  }

  // "Open in Jira" links. The site address comes from Forge's context: ticket
  // links from the API point at api.atlassian.com, not the Jira site.
  const jiraOrigin = siteUrl;
  const ticketLink = (ticket) => (siteUrl ? `${siteUrl}/browse/${ticket.key}` : ticket.url);
  const jiraSearch = (jql) => (jiraOrigin && jql ? `${jiraOrigin}/issues/?jql=${encodeURIComponent(jql)}` : '');
  const patternLink = (group) => {
    const keys = (group.keys || group.tickets.map((t) => t.key)).slice(0, MAX_LINK_KEYS);
    return jiraSearch(keys.length ? `key in (${keys.join(', ')}) ORDER BY created DESC` : '');
  };
  // The period's tickets narrowed by a field condition.
  const periodLink = (clause) => (clause && report?.baseJql ? jiraSearch(`${report.baseJql} AND ${clause} ORDER BY created DESC`) : '');
  const valueLink = (field, value) => periodLink(jqlClause(field, value));
  const qualityIssues = (report?.dataQuality || []).filter((d) => d.problemCount > 0);
  const bucketUnit = report && (Date.parse(report.endDate) - Date.parse(report.startDate)) / 86400000 < 35 ? 'day' : 'week';
  const canDrill = (field, value) => Boolean(jqlClause(field, value));
  const drill = (field, value) => runAnalysis(null, { id: field.id, label: field.label, value });
  const groupResolution = (group) => {
    const analysed = group.sampleCount || group.count;
    return { medianHours: median(group.resolvedHours || []), openShare: analysed ? Math.round(((group.openCount || 0) / analysed) * 100) : null };
  };

  const periodDays = report ? Math.max(1, Math.ceil((Date.parse(report.endDate) - Date.parse(report.startDate)) / 86400000) + 1) : 0;

  return <div className="nq-page">
    <AppHeader
      product={PRODUCT}
      subtitle="See recurring issues and what’s changing across a customer’s tickets."
      version={version}
      actions={report && <Button onClick={exportCsv}>Export CSV</Button>}
    />

    {!licensed && <Notice kind="warning" title="Customer Insights isn’t licensed on this site">
      Analysis is unavailable until the app has an active Marketplace licence. Ask a Jira admin to check it in Manage apps.
    </Notice>}

    {licensed && alerts.length > 0 && <Card
      title={<>Spike alerts <span className="nq-pill nq-pill--neutral">{alerts.length}</span></>}
      description="Patterns that jumped in a watched organisation’s last 7 days, against the 7 before. Checked once a day."
    >
      <ul className="ci-alerts">{alerts.map((alert) => <li key={alert.id}>
        <div className="ci-alerts__text">
          <strong>{alert.organization.name}: {alert.theme}</strong>
          <span className="nq-muted">{changeText(alert)} · {new Date(`${alert.window.from}T00:00:00`).toLocaleDateString()} to {new Date(`${alert.window.to}T00:00:00`).toLocaleDateString()}</span>
          <span className="ci-alerts__links">
            {alert.keys?.length > 0 && <JiraLink href={jiraSearch(`key in (${alert.keys.slice(0, MAX_LINK_KEYS).join(', ')}) ORDER BY created DESC`)}>Open {Math.min(alert.keys.length, MAX_LINK_KEYS)} tickets in Jira</JiraLink>}
            {alert.issueKey && <> · Ticket <JiraLink href={siteUrl ? `${siteUrl}/browse/${alert.issueKey}` : ''}>{alert.issueKey}</JiraLink></>}
            {alert.issueError && <> · <Lozenge kind="warning">Ticket not created</Lozenge> <span className="nq-muted">{alert.issueError}</span></>}
          </span>
        </div>
        <div className="ci-alerts__actions">
          <Button small onClick={() => analyseAlert(alert)} disabled={loadingReport || !orgs.some((o) => o.id === alert.organization.id)}>Analyse</Button>
          <Button small appearance="subtle" onClick={() => dismissAlert(alert)}>Dismiss</Button>
        </div>
      </li>)}</ul>
    </Card>}

    {licensed && <Card>
      <form className="nq-filters ci-filters" onSubmit={runAnalysis}>
        <Field label="Customer organisation" htmlFor="ci-org">
          <select id="ci-org" className="nq-select" value={orgIds[0] || ''} onChange={(e) => setOrgIds((ids) => [e.target.value, ...ids.slice(1).filter((id) => id !== e.target.value)])} disabled={loadingOrgs || !orgs.length}>
            {loadingOrgs && <option>Loading organisations…</option>}
            {!loadingOrgs && !orgs.length && <option value="">No organisations found</option>}
            {orgs.map((org) => <option value={org.id} key={org.id}>{org.name}</option>)}
          </select>
        </Field>
        <Field label={`Add organisations (${selectedOrgs.length} of ${MAX_ORGS})`} htmlFor="ci-org-add">
          <select id="ci-org-add" className="nq-select" value="" disabled={loadingOrgs || selectedOrgs.length >= MAX_ORGS || orgs.length < 2}
            onChange={(e) => { const id = e.target.value; if (id) setOrgIds((ids) => (ids.includes(id) ? ids : [...ids, id])); }}>
            <option value="">{selectedOrgs.length >= MAX_ORGS ? 'Up to 10 at a time' : 'Add another…'}</option>
            {orgs.filter((org) => !orgIds.includes(org.id)).map((org) => <option value={org.id} key={org.id}>{org.name}</option>)}
          </select>
        </Field>
        <Field label="Period" htmlFor="ci-period">
          <select id="ci-period" className="nq-select" value={preset} onChange={(e) => choosePreset(e.target.value)}>
            {PRESETS.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
            <option value="custom" disabled={preset !== 'custom'}>Custom dates</option>
          </select>
        </Field>
        <Field label="From" htmlFor="ci-from">
          <input id="ci-from" className="nq-input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="To" htmlFor="ci-to">
          <input id="ci-to" className="nq-input" type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Field label="Projects (optional)" htmlFor="ci-projects">
          <input id="ci-projects" className="nq-input" value={projectsText} onChange={(e) => setProjectsText(e.target.value)} placeholder="e.g. SD, HW" />
        </Field>
        <Button appearance="primary" type="submit" disabled={!selectedOrg || loadingOrgs || loadingReport}>
          {loadingReport ? 'Analysing…' : 'Run analysis'}
        </Button>
      </form>
      {selectedOrgs.length > 1 && <div className="ci-chips" aria-label="Selected organisations">
        {selectedOrgs.map((org) => <span className="ci-chip" key={org.id}>
          {org.name}
          <button type="button" aria-label={`Remove ${org.name}`} onClick={() => setOrgIds((ids) => ids.filter((id) => id !== org.id))}>×</button>
        </span>)}
        <Button small appearance="subtle" onClick={() => setOrgIds((ids) => ids.slice(0, 1))}>Clear extra</Button>
      </div>}
      <p className="nq-muted">
        {selectedOrgs.length > 1
          ? 'Analyses tickets shared with any of these organisations together, with a breakdown by organisation. Portal reports need a single organisation.'
          : 'Uses tickets shared with this organisation.'} Results follow your Jira permissions.
      </p>
    </Card>}

    {error && <Notice kind="error" title="We couldn’t complete that request.">{error}</Notice>}

    {filter && <Notice>
      <div className="nq-spread">
        <span>Showing only tickets where <strong>{filter.label}</strong> is <strong>{filter.value}</strong>.</span>
        <Button small onClick={() => runAnalysis(null, null)} disabled={loadingReport}>Clear filter</Button>
      </div>
    </Notice>}

    {licensed && !loadingOrgs && !report && !loadingReport && !error && <Card>
      <EmptyState
        title="Find the issues behind the numbers"
        actions={<Button appearance="primary" onClick={runAnalysis} disabled={!selectedOrg}>Analyse {orgLabel || 'customer tickets'}</Button>}
      >
        Choose a customer and date range to see ticket patterns, volume changes and example requests. Only Jira ticket data your account can access is analysed.
      </EmptyState>
    </Card>}

    {loadingReport && <Card><Loading text="Reading customer tickets and comparing this period with the one before it…" /></Card>}

    {report && <>
      <div className="nq-kpis">
        <Kpi icon="▤" label="Tickets in period" value={report.currentCount.toLocaleString()} hint={report.organizations?.length > 2 ? `for ${report.organizations.length} organisations` : `for ${report.organization}`} />
        <Kpi icon="↗" kind={report.change > 0 ? 'warning' : report.change < 0 ? 'success' : 'info'} label="Vs previous period" value={totalChange} hint={`${signed(report.change)} tickets · previous ${report.previousCount}`} />
        <Kpi icon="⌘" kind="warning" label="Recurring patterns" value={groups.length} hint={`with at least ${report.minPatternSize || 2} related tickets`} />
        <Kpi icon="✓" kind="success" label="Tickets analysed" value={report.analyzedCount.toLocaleString()} hint={report.sampled ? 'sample spread across the period' : 'rule-based text matching'} />
        {report.resolution && <Kpi icon="◷" kind="info" label="Median time to resolve" value={duration(report.resolution.medianHours)} hint={report.resolution.openShare ? `${report.resolution.openShare}% still open` : 'all resolved'} />}
      </div>

      {groups.length > 0 && <Card
        title="AI summary"
        description="Atlassian-hosted Claude. Ticket text stays on the Atlassian platform."
        actions={<Button appearance={ai ? 'default' : 'primary'} small onClick={runAi} disabled={aiLoading}>{aiLoading ? 'Summarising…' : ai ? 'Regenerate' : 'Summarise with AI'}</Button>}
        footer={ai && <span className="nq-muted">AI-generated from the pattern names, counts and example summaries above. Check the linked tickets before sharing.</span>}
      >
        {aiError && <Notice kind="error" title="The AI summary didn’t work.">{aiError}</Notice>}
        {aiLoading && <Loading inline text={aiStep === 'merge' ? 'Finding patterns that are the same issue…' : 'Naming the issues and writing a summary…'} />}
        {!ai && !aiLoading && !aiError && <p className="nq-muted">Get plain-English names for the top patterns, an overview for a customer review and suggested follow-ups.</p>}
        {ai && !aiLoading && <div className="nq-stack">
          {ai.mergedIssues > 0 && <p className="nq-muted">Combined {ai.mergedGroups + ai.mergedIssues} patterns that describe the same issue into {ai.mergedIssues}. Expand a pattern to see what it combines.</p>}
          {ai.overview && <p className="ci-ai__overview">{ai.overview}</p>}
          {ai.actions.length > 0 && <div>
            <strong>Suggested follow-ups</strong>
            <ul className="ci-ai__actions">{ai.actions.map((action) => <li key={action}>{action}</li>)}</ul>
          </div>}
        </div>}
      </Card>}

      <div className="nq-grid ci-split">
        <Card title="Ticket activity" description="Volume over time" actions={<span className="nq-pill nq-pill--neutral">{report.startDate} – {report.endDate}</span>}>
          {report.timeSeries.length
            ? <div className="ci-chart">
              <div className="ci-chart__axis"><span>{graphMax}</span><span>{Math.ceil(graphMax / 2)}</span><span>0</span></div>
              <div className="ci-chart__bars" role="img" aria-label="Ticket volume over time">
                {report.timeSeries.map((point, i) => <div className="ci-chart__slot" key={point.date} title={`${point.date}: ${point.count} tickets`}>
                  <div className="ci-chart__bar" style={{ height: `${Math.max(5, (point.count / graphMax) * 100)}%` }} />
                  <span>{i % labelEvery === 0 ? point.date.slice(5) : ''}</span>
                </div>)}
              </div>
            </div>
            : <EmptyState compact title="No tickets were created in this period." />}
        </Card>

        <Card title="What stands out" description="Quick read" footer={<span className="nq-muted">Patterns are based on matching ticket text. Review the examples before drawing conclusions.</span>}>
          {groups.length
            ? <ol className="ci-insights">{groups.slice(0, 3).map((g, index) => <li key={g.id}>
              <div>
                <strong>{patternName(g, index)}</strong>
                <p className="nq-muted">{g.estimated ? '≈' : ''}{g.count} related tickets{g.previousCount ? `, ${g.change >= 0 ? 'up' : 'down'} ${Math.abs(g.change)} from the previous period` : ', newly recurring this period'}</p>
              </div>
              <span className="ci-insights__count">{g.estimated ? '≈' : ''}{g.count}</span>
            </li>)}</ol>
            : <EmptyState compact title="No repeated patterns found in these tickets yet." />}
        </Card>
      </div>

      {report.breakdowns?.length > 0
        ? <div className="nq-grid ci-breakdowns">{report.breakdowns.map((b) => {
          const top = Math.max(1, ...b.values.map((v) => v.count));
          const field = report.breakdownFields?.find((f) => f.id === b.id) || b;
          return <Card key={b.id} title={`By ${b.label}`} description={b.estimated ? 'Estimated from the sample' : 'All tickets in the period'}>
            {b.values.length
              ? <ol className="ci-values">{b.values.map((v) => <li key={v.value}>
                <span className="ci-values__name" title={v.value}>
                  {canDrill(field, v.value) && !filter
                    ? <button type="button" className="ci-link" onClick={() => drill(field, v.value)} title={`Analyse only ${v.value}`}>{v.value}</button>
                    : v.value}
                </span>
                <span className="ci-meter"><i style={{ width: `${Math.max(4, (v.count / top) * 100)}%` }} /></span>
                <span className="ci-values__count">{b.estimated ? '≈' : ''}{v.count.toLocaleString()}</span>
                <TrendLozenge group={v} />
                {v.medianHours !== undefined && <small className="ci-values__meta">
                  {resolutionText(v)}
                  {valueLink(field, v.value) && <> · <JiraLink href={valueLink(field, v.value)}>Open in Jira</JiraLink></>}
                </small>}
              </li>)}</ol>
              : <EmptyState compact title={`No ${b.label} values on these tickets.`} />}
            {b.withoutValue > 0 && <p className="nq-muted">{b.estimated ? '≈' : ''}{b.withoutValue.toLocaleString()} tickets have no {b.label}.</p>}
          </Card>;
        })}</div>
        : <p className="nq-muted">Tip: a Jira admin can add breakdowns by base, device type or any other field in <strong>Jira settings → Apps → Customer Insights</strong>.</p>}

      {report.timeOfDay?.analysed > 0 && (() => {
        const { grid, timeZone, estimated, analysed } = report.timeOfDay;
        const hours = hoursOf(grid);
        const peak = peakWindow(hours);
        const outside = outOfHoursShare(grid);
        const dayTotals = grid.map((row) => row.reduce((a, n) => a + n, 0));
        const busiestDay = DAYS[dayTotals.indexOf(Math.max(...dayTotals))];
        return <Card title="When tickets arrive" description={`Created time in ${timeZone}. ${estimated ? `Shares of the ${analysed.toLocaleString()} analysed tickets.` : 'All tickets in the period.'}`}>
          <div className="nq-kpis ci-when">
            {peak && <Kpi icon="◷" label="Busiest 3 hours" value={windowText(peak)} hint={`${peak.share}% of tickets`} />}
            <Kpi icon="▦" label="Busiest day" value={busiestDay} hint={`${Math.round((Math.max(...dayTotals) / Math.max(1, analysed)) * 100)}% of tickets`} />
            {outside !== null && <Kpi icon="☾" kind={outside >= 30 ? 'warning' : 'info'} label="Out of hours" value={`${outside}%`} hint={`outside ${String(WORKING.from).padStart(2, '0')}:00–${WORKING.to}:00 Mon–Fri`} />}
          </div>
          <TimeHeatmap grid={grid} />
        </Card>;
      })()}

      {qualityIssues.length > 0 && <Card
        title="Data quality"
        description={`Breakdown fields left empty or set to a placeholder such as “Unknown”. ${qualityIssues.some((d) => d.estimated) ? 'Estimated from the sample.' : 'All tickets in the period.'}`}
      >
        <ul className="ci-quality">{qualityIssues.map((d) => {
          const field = report.breakdownFields?.find((f) => f.id === d.id) || d;
          const approx = d.estimated ? '≈' : '';
          const parts = [
            d.missing > 0 && { key: 'none', text: `No value: ${approx}${d.missing.toLocaleString()}`, href: periodLink(jqlEmptyClause(field)) },
            ...d.placeholders.map((p) => ({ key: p.value, text: `${p.value}: ${approx}${p.count.toLocaleString()}`, href: periodLink(jqlClause(field, p.value)) })),
          ].filter(Boolean);
          return <li key={d.id}>
            <div className="nq-spread">
              <strong>{d.label}</strong>
              <span><strong>{d.share}%</strong> of tickets ({approx}{d.problemCount.toLocaleString()}) have no real {d.label}</span>
            </div>
            <span className="ci-meter ci-meter--warning"><i style={{ width: `${Math.max(2, d.share)}%` }} /></span>
            <p className="nq-muted ci-quality__parts">{parts.map((part, i) => <React.Fragment key={part.key}>
              {i > 0 && ' · '}
              {part.href ? <JiraLink href={part.href}>{part.text}</JiraLink> : part.text}
            </React.Fragment>)}</p>
            {d.examples.length > 0 && <ul className="ci-quality__examples">{d.examples.map((e) => <li key={e.key}>
              <JiraLink className="nq-table__key" href={ticketLink(e)}>{e.key}</JiraLink>
              <span>{e.summary}</span>
              <span className="nq-muted">{e.value || 'no value'}</span>
            </li>)}</ul>}
          </li>;
        })}</ul>
      </Card>}

      <Card
        title={<>Issue patterns <span className="nq-pill nq-pill--neutral">{groups.length}</span></>}
        description="Repeated customer issues, with ticket evidence"
        footer={<span className="nq-muted">Similarity groups use ticket summaries and descriptions. They are clues for review, not confirmed root causes.</span>}
      >
        {report.sampled && !fullRun && <Notice>
          <div className="nq-spread ci-full">
            <span>Patterns come from {report.analyzedCount.toLocaleString()} of {report.currentCount.toLocaleString()} tickets, sampled evenly across the period. Sizes marked ≈ are estimates; ticket totals, the comparison and the chart are exact.</span>
            {report.currentCount <= FULL_LIMIT && report.previousCount <= FULL_LIMIT
              ? <Button small onClick={runFull}>Analyse every ticket</Button>
              : <span className="nq-muted">Too many tickets to analyse all of them; narrow the period or add a project.</span>}
          </div>
        </Notice>}
        {fullRun && <div className="ci-progress" role="status" aria-live="polite">
          <div className="nq-spread">
            <span>{fullRun.phase === 'grouping'
              ? `Grouping ${fullRun.fetched.toLocaleString()} tickets…`
              : `Reading tickets: ${fullRun.fetched.toLocaleString()} of ${fullRun.total.toLocaleString()}`}</span>
            <Button small appearance="subtle" onClick={() => { cancelFull.current = true; setFullRun(null); }}>Cancel</Button>
          </div>
          <div className="ci-meter ci-progress__bar"><i style={{ width: `${Math.min(100, Math.round((fullRun.fetched / Math.max(1, fullRun.total)) * 100))}%` }} /></div>
        </div>}
        {fullError && <Notice kind="error" title="The full analysis didn’t finish.">{fullError}</Notice>}
        {report.full && <Notice kind="success">All {report.currentCount.toLocaleString()} tickets in the period were analysed (plus {report.previousCount.toLocaleString()} from the previous period for trends).</Notice>}
        {report.cutShort && <Notice kind="warning">
          The analysis stopped fetching early to stay within Jira’s time limit, so the sample is smaller than usual. Try a shorter period or a project filter.
        </Notice>}
        {groups.length
          ? <div className="ci-patterns">{groups.map((group, index) => <details className="ci-pattern" key={group.id}>
            <summary>
              <span className="ci-pattern__title">
                <strong>{patternName(group, index)}</strong>
                {(aiPattern(index) || group.ruleNames) && <small className="nq-muted">
                  {group.mergedFrom ? `Combines ${group.mergedFrom.length}: ${group.mergedFrom.join(' · ')}` : (group.ruleNames?.[0] || group.theme)}
                  {aiPattern(index)?.coherent === false && <> · <Lozenge kind="warning">Mixed</Lozenge></>}
                </small>}
              </span>
              <span className="ci-pattern__sample nq-muted">
                {aiPattern(index)?.summary || group.sampleSummary}
                {whereOf(group) && <em className="ci-where">{whereOf(group)}</em>}
              </span>
              <span className="ci-pattern__volume">
                <Sparkline points={patternTrend(group, report)} unit={bucketUnit} />
                <span className="ci-meter"><i style={{ width: `${Math.max(8, (group.count / maxGroup) * 100)}%` }} /></span>
              </span>
              <span className="ci-pattern__count" title={group.estimated ? `${group.sampleCount} in the sample` : undefined}>{group.estimated ? '≈' : ''}{group.count}</span>
              <TrendLozenge group={group} />
              <span className="ci-pattern__chevron" aria-hidden="true">›</span>
            </summary>
            <div className="nq-spread ci-pattern__meta">
              <span className="nq-muted">
                {trendWord(patternTrend(group, report)) && <>{trendWord(patternTrend(group, report))} through the period · </>}
                {peakWindow(group.hours) && <>mostly {windowText(peakWindow(group.hours))} ({peakWindow(group.hours).share}%) · </>}
                {resolutionText(groupResolution(group))}{group.estimated ? ' (from the sample)' : ''}
              </span>
              {patternLink(group) && <JiraLink href={patternLink(group)}>
                {(() => {
                  const n = Math.min((group.keys || group.tickets).length, MAX_LINK_KEYS);
                  return group.estimated ? `Open the ${n} sampled tickets in Jira` : `Open ${n} tickets in Jira`;
                })()}
              </JiraLink>}
            </div>
            <div className="nq-table-wrap">
              <table className="nq-table">
                <thead><tr><th>Key</th><th>Summary</th><th>Status</th><th>Created</th></tr></thead>
                <tbody>{group.tickets.map((ticket) => <tr key={ticket.key}>
                  <td><JiraLink className="nq-table__key" href={ticketLink(ticket)}>{ticket.key}</JiraLink></td>
                  <td>{ticket.summary}</td>
                  <td><Lozenge>{ticket.status}</Lozenge></td>
                  <td>{new Date(ticket.created).toLocaleDateString()}</td>
                </tr>)}</tbody>
              </table>
            </div>
          </details>)}</div>
          : <EmptyState compact title="No repeated issue patterns detected">There are no groups of similar tickets with more than one request in this period.</EmptyState>}
      </Card>

      {!reportOrgId && report.organizations?.length > 1 && <p className="nq-muted">Portal reports are published for one organisation at a time. Choose a single organisation to prepare one.</p>}

      {reportOrgId && publication?.portalEnabled !== false && <Card
        title="Customer portal"
        description={`What ${report.organization}'s portal users see under “Service report” in their user menu.`}
        actions={publication?.canPublish && !draft && <>
          {publication.published && <Button small appearance="subtle" onClick={unpublish} disabled={publishing}>Remove from portal</Button>}
          <Button small appearance="primary" onClick={prepareDraft} disabled={publishing}>{publication.published ? 'Replace portal report' : 'Prepare portal report'}</Button>
        </>}
      >
        {publishError && <Notice kind="error" title="Portal report">{publishError}</Notice>}
        {!publication && !publishError && <Loading inline text="Checking the portal report…" />}
        {publication && <p className="nq-muted">
          {publication.published
            ? `Published ${new Date(publication.published.publishedAt).toLocaleString()} for ${publication.published.period.from} to ${publication.published.period.to}.`
            : 'Nothing is published for this organisation yet.'}
          {!publication.canPublish && ' Only Jira admins and project admins can publish.'}
        </p>}
        {publication?.published?.live && !draft && <div className="nq-stack">
          <div className="nq-spread ci-live">
            <span>
              <Lozenge kind="success">Live</Lozenge>{' '}
              {presetLabel(publication.published.live.preset)}, refreshed {publication.published.live.schedule}.
              {' '}Numbers last refreshed {new Date(publication.published.refreshedAt).toLocaleString()}; summary written {new Date(publication.published.summaryWrittenAt).toLocaleDateString()}.
              {publication.liveState?.queuedAt && ' A refresh is queued.'}
            </span>
            {publication.canPublish && <Button small onClick={refreshLive} disabled={Boolean(publication.liveState?.queuedAt)}>Refresh now</Button>}
          </div>
          {publication.liveState?.lastError && <Notice kind="warning" title="The last refresh failed.">{publication.liveState.lastError}</Notice>}
          {publication.published.unreviewed?.length > 0 && <Notice kind="discovery" title="New issues since the last review">
            {publication.published.unreviewed.map((u) => `${u.title} (${u.count})`).join(' · ')}. Customers see these under “Other requests” until you replace the portal report with them named.
          </Notice>}
        </div>}
        {draft && <div className="nq-stack">
          <Notice>
            Customers see your names, descriptions, summary and next steps. Customer Insights then builds the rest from {report.organization}’s own tickets:
            counts, trends, time to resolve, the newest example tickets for each issue (only tickets shared with {report.organization}, linking to their portal
            request), and the breakdowns an admin marked “Show on portal”. Data quality, alerts and other organisations are never shown.
            {ai ? '' : ' Run the AI summary first for suggested names and a summary.'}
          </Notice>
          <div className="ci-draft">
            {draft.patterns.map((p, index) => <div className="ci-draft__row" key={index}>
              <input type="checkbox" className="nq-check" checked={p.include} aria-label={`Include ${p.title}`} onChange={(e) => editPattern(index, { include: e.target.checked })} />
              <input className="nq-input" value={p.title} maxLength={80} aria-label="Issue name" onChange={(e) => editPattern(index, { title: e.target.value })} />
              <input className="nq-input" value={p.summary} maxLength={300} placeholder="One-line description (optional)" aria-label="Issue description" onChange={(e) => editPattern(index, { summary: e.target.value })} />
              <span className="nq-muted">{p.estimated ? '≈' : ''}{p.count}</span>
            </div>)}
          </div>
          <Field label="Summary" htmlFor="ci-draft-overview">
            <textarea id="ci-draft-overview" className="nq-textarea" rows={4} maxLength={1500} value={draft.overview} onChange={(e) => setDraft((d) => ({ ...d, overview: e.target.value }))} />
          </Field>
          <Field label="Next steps (one per line)" htmlFor="ci-draft-actions" help="These are shown to the customer. Remove anything internal.">
            <textarea id="ci-draft-actions" className="nq-textarea" rows={3} value={draft.actions} onChange={(e) => setDraft((d) => ({ ...d, actions: e.target.value }))} />
          </Field>
          <div className="ci-live-edit">
            <Field label="Keep up to date" htmlFor="ci-draft-schedule" help="Refreshes the numbers for the issues above. Your summary and next steps stay as written, with their date.">
              <select id="ci-draft-schedule" className="nq-select" value={draft.live.schedule} onChange={(e) => setDraft((d) => ({ ...d, live: { ...d.live, schedule: e.target.value } }))}>
                <option value="off">Off (publish as a one-off)</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </Field>
            {draft.live.schedule !== 'off' && <Field label="Period shown" htmlFor="ci-draft-preset" help="Rolls forward on every refresh. Customers can also refresh once an hour.">
              <select id="ci-draft-preset" className="nq-select" value={draft.live.preset} onChange={(e) => setDraft((d) => ({ ...d, live: { ...d.live, preset: e.target.value } }))}>
                {PRESETS.map(({ key, label }) => <option key={key} value={key}>{label}</option>)}
              </select>
            </Field>}
          </div>
          <div className="nq-inline">
            <Button appearance="primary" onClick={publish} disabled={publishing || Boolean(filter) || !draft.patterns.some((p) => p.include && p.title.trim())}>{publishing ? 'Publishing…' : 'Publish to portal'}</Button>
            {filter && <span className="nq-muted">Clear the {filter.label} filter first: portal reports cover all of the organisation’s tickets.</span>}
            <Button appearance="subtle" onClick={() => setDraft(null)} disabled={publishing}>Cancel</Button>
          </div>
        </div>}
      </Card>}

      <div className="nq-spread ci-method">
        <span className="nq-muted">Analysis period: {report.startDate} to {report.endDate} · compared with the preceding {periodDays} days</span>
        <Button appearance="link" small onClick={() => setQueryOpen(!queryOpen)}>{queryOpen ? 'Hide' : 'Show'} search details</Button>
      </div>
      {queryOpen && <Notice title="Data source">
        Jira issues with <code>{report.baseJql?.split(' AND created')[0] || `organizations = "${report.organization}"`}</code>, created between {report.startDate} and {report.endDate}. A preceding equal-length period is used for comparison. Only tickets visible to your Jira account are included.
      </Notice>}
    </>}

    <Footer product={PRODUCT} version={version} />
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
