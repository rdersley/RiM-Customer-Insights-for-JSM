// Customer Insights settings (Jira settings → Apps). Jira admins choose which
// of the site's own fields to break reports down by, and whether reports can
// be published to the customer portal. Nothing site-specific is hard-coded.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke, view } from '@forge/bridge';
import '@retailinmotion/ui/css';
import { enableTheme } from '@retailinmotion/ui/theme';
import { ActionBar, AppHeader, Button, Card, Field, Footer, Loading, Notice, Tabs } from '@retailinmotion/ui/react';
import { version } from '../../../package.json';
import { DEFAULT_INTERNAL_SYNONYMS, DEFAULT_SETTINGS, MAX_CLIENT_FIELDS, ALERT_LIMITS, DEFAULT_ALERTS, DEFAULT_PLACEHOLDERS, DEFAULT_SYNONYMS, MAX_BREAKDOWNS, MAX_PLACEHOLDERS, MAX_WATCHED, MIN_PATTERN, SYNONYM_LIMITS } from '../../../src/settings.js';
import BackupRestore from './BackupRestore.jsx';
import BreakdownFields from './BreakdownFields.jsx';
import PatternSettings from './PatternSettings.jsx';
import CrewNumbers from './CrewNumbers.jsx';
import SurgeSettings from './SurgeSettings.jsx';
import PdfLogos from './PdfLogos.jsx';
import './styles.css';

enableTheme(view);

const PRODUCT = 'Customer Insights';

function App() {
  const [state, setState] = useState({ loading: true });
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    invoke('getSettings')
      .then((result) => {
        setState({ loading: false, ...result });
        if (result.isAdmin) setDraft(result.settings);
      })
      .catch((e) => setState({ loading: false, error: e.message || 'Settings could not be loaded.' }));
  }, []);

  const dirty = draft && state.settings && JSON.stringify(draft) !== JSON.stringify(state.settings);
  const [orgFilter, setOrgFilter] = useState('');
  const [checkNote, setCheckNote] = useState('');
  const [clientSearch, setClientSearch] = useState('');
  const [tab, setTab] = useState('customers');
  const alerts = { ...DEFAULT_ALERTS, ...draft?.alerts };
  const setAlerts = (change) => { setSaved(false); setDraft((d) => ({ ...d, alerts: { ...DEFAULT_ALERTS, ...d.alerts, ...change } })); };
  // Watched organisations first, then matches for the filter (at most 50 listed).
  const shownOrgs = (() => {
    const term = orgFilter.trim().toLowerCase();
    const watched = alerts.organizations;
    const others = (state.organizations || []).filter((o) => !watched.some((w) => w.id === o.id) && (!term || o.name.toLowerCase().includes(term)));
    return [...watched.filter((o) => !term || o.name.toLowerCase().includes(term)), ...others.slice(0, 50)];
  })();

  async function save() {
    setSaving(true); setError('');
    try {
      const settings = await invoke('saveSettings', { settings: draft });
      setState((s) => ({ ...s, settings })); setDraft(settings); setSaved(true);
    } catch (e) { setError(e.message || 'Saving failed.'); }
    finally { setSaving(false); }
  }

  if (state.loading) return <div className="nq-page"><Loading text="Loading settings…" /></div>;

  return <div className="nq-page nq-page--narrow">
    <AppHeader product={PRODUCT} subtitle="Settings for everyone using Customer Insights on this site." version={version} />
    {state.error && <Notice kind="error" title="Something went wrong.">{state.error}</Notice>}
    {state.isAdmin === false && <Notice kind="warning">Only Jira admins can change Customer Insights settings.</Notice>}
    {error && <Notice kind="error" title="Settings weren’t saved.">{error}</Notice>}

    {draft && <>
      <div className="cs-tabs"><Tabs items={[{ id: 'customers', label: 'Customers' }, { id: 'internal', label: 'Internal' }, { id: 'general', label: 'Backup' }]} active={tab} onChange={setTab} /></div>

      {tab === 'customers' && <>
      <BreakdownFields id="cs-bd" title="Breakdown fields" showPortal fields={state.fields}
        description={`Customer reports show tickets and each issue split by these fields, for example base or device type. Up to ${MAX_BREAKDOWNS}.`}
        list={draft.breakdowns} onChange={(breakdowns) => { setSaved(false); setDraft((d) => ({ ...d, breakdowns })); }} />

      <PatternSettings id="cs-cust" value={draft} onChange={(change) => { setSaved(false); setDraft((d) => ({ ...d, ...change })); }} />

      <CrewNumbers headcounts={draft.headcounts || []} organizations={state.organizations || []} breakdowns={state.settings.breakdowns} portalEnabled={draft.portalEnabled === true}
        onChange={(headcounts) => { setSaved(false); setDraft((d) => ({ ...d, headcounts })); }} />

      <Card title="Spike alerts" description="Once a day, compare each watched organisation’s last 7 days with the 7 before. Patterns that jump show as alerts in Customer Insights.">
        <div className="nq-stack">
          <label className="cs-check">
            <input type="checkbox" className="nq-check" checked={alerts.enabled} onChange={(e) => setAlerts({ enabled: e.target.checked })} />
            <span>Check for spikes every day</span>
          </label>
          {alerts.enabled && <>
            <Field label={`Organisations to watch (${alerts.organizations.length} of ${MAX_WATCHED})`} htmlFor="cs-org-filter">
              <input id="cs-org-filter" className="nq-input" placeholder="Filter organisations" value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)} />
            </Field>
            <div className="cs-orgs" role="group" aria-label="Organisations to watch">
              {shownOrgs.map((o) => {
                const checked = alerts.organizations.some((w) => w.id === o.id);
                return <label className="cs-check" key={o.id}>
                  <input type="checkbox" className="nq-check" checked={checked} disabled={!checked && alerts.organizations.length >= MAX_WATCHED}
                    onChange={(e) => setAlerts({ organizations: e.target.checked ? [...alerts.organizations, o] : alerts.organizations.filter((w) => w.id !== o.id) })} />
                  <span>{o.name}</span>
                </label>;
              })}
              {!shownOrgs.length && <p className="nq-muted">No organisations match.</p>}
            </div>
            <div className="cs-row cs-row--pair">
              <Field label="Alert when a pattern is up by (%)" htmlFor="cs-threshold" help={`${ALERT_LIMITS.threshold.min}–${ALERT_LIMITS.threshold.max}%, against the week before. New patterns count too.`}>
                <input id="cs-threshold" className="nq-input cs-number" type="number" min={ALERT_LIMITS.threshold.min} max={ALERT_LIMITS.threshold.max}
                  value={alerts.thresholdPercent} onChange={(e) => setAlerts({ thresholdPercent: Number(e.target.value) })} />
              </Field>
              <Field label="And has at least (tickets)" htmlFor="cs-min-tickets" help={`${ALERT_LIMITS.minTickets.min}–${ALERT_LIMITS.minTickets.max} tickets in the last 7 days.`}>
                <input id="cs-min-tickets" className="nq-input cs-number" type="number" min={ALERT_LIMITS.minTickets.min} max={ALERT_LIMITS.minTickets.max}
                  value={alerts.minTickets} onChange={(e) => setAlerts({ minTickets: Number(e.target.value) })} />
              </Field>
            </div>
            <label className="cs-check">
              <input type="checkbox" className="nq-check" checked={alerts.createIssue} onChange={(e) => setAlerts({ createIssue: e.target.checked })} />
              <span>Also create a Jira ticket for each alert</span>
            </label>
            {alerts.createIssue && <>
              <div className="cs-row cs-row--pair">
                <Field label="Project key" htmlFor="cs-alert-project">
                  <input id="cs-alert-project" className="nq-input" placeholder="e.g. SD" maxLength={50} value={alerts.projectKey}
                    onChange={(e) => setAlerts({ projectKey: e.target.value.toUpperCase(), issueTypeId: '' })} />
                </Field>
                <Field label="Issue type" htmlFor="cs-alert-type">
                  <input id="cs-alert-type" className="nq-input" placeholder="e.g. Task" maxLength={60} value={alerts.issueTypeName}
                    onChange={(e) => setAlerts({ issueTypeName: e.target.value, issueTypeId: '' })} />
                </Field>
              </div>
              <p className="nq-muted">Tickets are created by the Customer Insights app user, labelled <code>customer-insights-spike</code>. It needs permission to create issues in that project; the project and issue type are checked when you save.</p>
            </>}
            <div className="nq-spread">
              <span className="nq-muted">{checkNote || 'Checks run once a day. New alerts show at the top of Customer Insights.'}</span>
              <Button small disabled={dirty || !state.settings?.alerts?.enabled || !state.settings?.alerts?.organizations?.length}
                onClick={async () => {
                  setCheckNote('Queuing…');
                  try { const { queued } = await invoke('checkAlertsNow'); setCheckNote(`Checking ${queued} organisation${queued === 1 ? '' : 's'} now. Alerts appear within a few minutes.`); }
                  catch (e) { setCheckNote(e.message || 'The check couldn’t be started.'); }
                }}>Check now</Button>
            </div>
          </>}
        </div>
      </Card>

      <SurgeSettings value={draft.surge} organizations={state.organizations || []} breakdowns={state.settings.breakdowns} fields={state.fields || []}
        onChange={(surge) => { setSaved(false); setDraft((d) => ({ ...d, surge })); }} />

      <Card title="Customer portal" description="Let Jira admins and project admins publish reviewed reports that customers see under “Service report” in the portal.">
        <label className="cs-check">
          <input type="checkbox" className="nq-check" checked={draft.portalEnabled === true}
            onChange={(e) => { setSaved(false); setDraft((d) => ({ ...d, portalEnabled: e.target.checked })); }} />
          <span>Allow publishing reports to the customer portal</span>
        </label>
        <p className="nq-muted">Off by default. While it’s off, “Service report” in the portal menu tells customers reports aren’t available, and nothing is published.</p>
      </Card>

      <PdfLogos invoke={invoke} organizations={state.organizations || []} />

      </>}

      {tab === 'internal' && <>
      <Card title="Client fields" description="The Internal tab analyses your own projects instead of customer organisations. Choose the fields that hold the client, so an analysis can be narrowed to a client and broken down by client. Different projects can use different fields (for example SD Client in SD and Client elsewhere).">
        <Field label={`Client fields (up to ${MAX_CLIENT_FIELDS})`} htmlFor="cs-client-fields"
          help="Select lists, checkboxes, cascading selects and labels can be used. A ticket's client is read from whichever of these it has.">
          <input className="nq-input cs-field-search" placeholder="Search fields" aria-label="Search client fields" value={clientSearch} onChange={(e) => setClientSearch(e.target.value)} />
          <div className="cs-orgs" id="cs-client-fields">{(() => {
            const chosen = (draft.clientFields || []).map((x) => x.id ?? x);
            const term = clientSearch.trim().toLowerCase();
            const usable = state.fields.filter((f) => /^customfield_/.test(f.id) && ['option', 'options', 'cascading', 'strings'].includes(f.kind));
            // Ticked fields first, then matches for the search.
            return [...usable.filter((f) => chosen.includes(f.id)), ...usable.filter((f) => !chosen.includes(f.id) && (!term || f.name.toLowerCase().includes(term)))];
          })().map((f) => {
            const chosen = (draft.clientFields || []).map((x) => x.id ?? x);
            const on = chosen.includes(f.id);
            return <label className="cs-check" key={f.id}>
              <input type="checkbox" className="nq-check" checked={on} disabled={!on && chosen.length >= MAX_CLIENT_FIELDS}
                onChange={(e) => { setSaved(false); setDraft((d) => ({ ...d, clientFields: e.target.checked ? [...chosen, f.id] : chosen.filter((id) => id !== f.id) })); }} />
              <span>{f.name}</span>
            </label>;
          })}</div>
        </Field>
      </Card>

      <BreakdownFields id="cs-ibd" title="Breakdown fields" fields={state.fields}
        description={`Internal reports show tickets and each issue split by these fields, for example team, component or category. Project and Client are added automatically. Up to ${MAX_BREAKDOWNS}.`}
        list={draft.internalBreakdowns || []} onChange={(internalBreakdowns) => { setSaved(false); setDraft((d) => ({ ...d, internalBreakdowns })); }} />

      <PatternSettings id="cs-int" value={{ ...DEFAULT_SETTINGS.internalPatterns, ...draft.internalPatterns }} defaultSynonyms={DEFAULT_INTERNAL_SYNONYMS}
        onChange={(change) => { setSaved(false); setDraft((d) => ({ ...d, internalPatterns: { ...DEFAULT_SETTINGS.internalPatterns, ...d.internalPatterns, ...change } })); }} />

      </>}

      <ActionBar state={saving ? 'Saving…' : dirty ? 'Unsaved changes' : saved ? 'Saved' : ''}>
        <Button appearance="subtle" disabled={!dirty || saving} onClick={() => { setDraft(state.settings); setSaved(false); }}>Discard</Button>
        <Button appearance="primary" disabled={!dirty || saving} onClick={save}>Save</Button>
      </ActionBar>

      {tab === 'general' && <>
      <BackupRestore invoke={invoke} app="Customer Insights" filePrefix="retailinmotion-customer-insights" />
      </>}
    </>}
    <Footer product={PRODUCT} version={version} />
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
