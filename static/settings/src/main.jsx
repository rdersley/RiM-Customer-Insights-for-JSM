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
import InternalSettings from './InternalSettings.jsx';
import ReportSections from './ReportSections.jsx';
import SlaSettings from './SlaSettings.jsx';
import DeviceSettings from './DeviceSettings.jsx';
import EmailReports from './EmailReports.jsx';
import CrewNumbers from './CrewNumbers.jsx';
import SurgeSettings from './SurgeSettings.jsx';
import HealthSettings from './HealthSettings.jsx';
import PdfLogos from './PdfLogos.jsx';
import rimLogo from './assets/rim-logo.png';
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
    <AppHeader icon={<img className="ci-logo" src={rimLogo} alt="" />} product={PRODUCT} subtitle="Settings for everyone using Customer Insights on this site." version={version} />
    {state.error && <Notice kind="error" title="Something went wrong.">{state.error}</Notice>}
    {state.isAdmin === false && <Notice kind="warning">Only Jira admins can change Customer Insights settings.</Notice>}
    {error && <Notice kind="error" title="Settings weren’t saved.">{error}</Notice>}

    {draft && <>
      <div className="cs-tabs"><Tabs items={[{ id: 'customers', label: 'Customers' }, { id: 'internal', label: 'Internal' }, { id: 'general', label: 'Backup' }]} active={tab} onChange={setTab} /></div>

      {tab === 'customers' && <>
      <ReportSections scope="customers" value={draft.hiddenSections} onChange={(hiddenSections) => { setSaved(false); setDraft((d) => ({ ...d, hiddenSections })); }} />

      <SlaSettings scope="customers" value={draft.customerSlaFields ?? draft.slaFields ?? []} choices={state.slaChoices || []}
        onChange={(ids) => { setSaved(false); setDraft((d) => ({ ...d, customerSlaFields: ids.map((id) => (state.slaChoices || []).find((c) => c.id === id) || { id }) })); }} />

      <BreakdownFields id="cs-bd" title="Breakdown fields" showPortal fields={state.fields}
        description={`Customer reports show tickets and each issue split by these fields, for example base or device type. Up to ${MAX_BREAKDOWNS}.`}
        list={draft.breakdowns} onChange={(breakdowns) => { setSaved(false); setDraft((d) => ({ ...d, breakdowns })); }} />

      <PatternSettings id="cs-cust" value={draft} onChange={(change) => { setSaved(false); setDraft((d) => ({ ...d, ...change })); }} />

      <Card title="Contact channel" description="Split “when tickets arrive” by how tickets came in (for example Phone and Email), on reports, PDFs and the customer portal, so customers can see where peaks come from.">
        <Field label="Channel field" htmlFor="cs-channel" help="A select field that records the contact channel, for example Issue Received by.">
          <select id="cs-channel" className="nq-select" value={draft.channelField?.id || ''}
            onChange={(e) => { const field = state.fields.find((x) => x.id === e.target.value); setSaved(false); setDraft((d) => ({ ...d, channelField: field ? { id: field.id, name: field.name, kind: field.kind } : null })); }}>
            <option value="">Off</option>
            {state.fields.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </Field>
      </Card>

      <DeviceSettings value={draft.devices} idChoices={state.idChoices || []} fields={state.fields}
        onChange={(devices) => { setSaved(false); setDraft((d) => ({ ...d, devices })); }} />

      <CrewNumbers headcounts={draft.headcounts || []} organizations={state.organizations || []} breakdowns={state.settings.breakdowns} portalEnabled={draft.portalEnabled === true} p1Percent={draft.devices?.p1Percent ?? 20} p2Percent={draft.devices?.p2Percent ?? 5}
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

      <HealthSettings value={draft.health} organizations={state.organizations || []} canRefresh={!dirty && Boolean(state.settings?.health?.enabled)}
        onChange={(health) => { setSaved(false); setDraft((d) => ({ ...d, health })); }} />

      <Card title="Customer portal" description="Let Jira admins and project admins publish reviewed reports that customers see under “Service report” in the portal.">
        <label className="cs-check">
          <input type="checkbox" className="nq-check" checked={draft.portalEnabled === true}
            onChange={(e) => { setSaved(false); setDraft((d) => ({ ...d, portalEnabled: e.target.checked })); }} />
          <span>Allow publishing reports to the customer portal</span>
        </label>
        <p className="nq-muted">Off by default. While it’s off, “Service report” in the portal menu tells customers reports aren’t available, and nothing is published.</p>
      </Card>


      <PdfLogos invoke={invoke} organizations={state.organizations || []} />

      <EmailReports invoke={invoke} organizations={state.organizations || []} />

      </>}

      {tab === 'internal' && <InternalSettings draft={draft} fields={state.fields} slaChoices={state.slaChoices || []} invoke={invoke}
        update={(fn) => { setSaved(false); setDraft(fn); }} />}

      {tab === 'internal' && <ReportSections scope="internal" value={draft.hiddenSections} onChange={(hiddenSections) => { setSaved(false); setDraft((d) => ({ ...d, hiddenSections })); }} />}

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
