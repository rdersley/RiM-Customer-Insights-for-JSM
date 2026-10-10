// Customer Insights settings (Jira settings → Apps). Jira admins choose which
// of the site's own fields to break reports down by, and whether reports can
// be published to the customer portal. Nothing site-specific is hard-coded.
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke, view } from '@forge/bridge';
import '@retailinmotion/ui/css';
import { enableTheme } from '@retailinmotion/ui/theme';
import { ActionBar, AppHeader, Button, Card, Field, Footer, Loading, Notice } from '@retailinmotion/ui/react';
import { version } from '../../../package.json';
import { ALERT_LIMITS, DEFAULT_ALERTS, DEFAULT_PLACEHOLDERS, DEFAULT_SYNONYMS, MAX_BREAKDOWNS, MAX_PLACEHOLDERS, MAX_WATCHED, MIN_PATTERN, SYNONYM_LIMITS } from '../../../src/settings.js';
import BackupRestore from './BackupRestore.jsx';
import CrewNumbers from './CrewNumbers.jsx';
import SurgeSettings from './SurgeSettings.jsx';
import PdfLogos from './PdfLogos.jsx';
import './styles.css';

enableTheme(view);

const PRODUCT = 'Customer Insights';
// Saved lists show as "first = the rest"; text being edited is kept as typed.
const synonymText = (value) => (Array.isArray(value) ? value.map((list) => `${list[0]} = ${list.slice(1).join(', ')}`).join('\n') : value);

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
  const fieldName = (id) => state.fields?.find((f) => f.id === id)?.name || '';
  const [orgFilter, setOrgFilter] = useState('');
  const [checkNote, setCheckNote] = useState('');
  const alerts = { ...DEFAULT_ALERTS, ...draft?.alerts };
  const setAlerts = (change) => { setSaved(false); setDraft((d) => ({ ...d, alerts: { ...DEFAULT_ALERTS, ...d.alerts, ...change } })); };
  // Watched organisations first, then matches for the filter (at most 50 listed).
  const shownOrgs = (() => {
    const term = orgFilter.trim().toLowerCase();
    const watched = alerts.organizations;
    const others = (state.organizations || []).filter((o) => !watched.some((w) => w.id === o.id) && (!term || o.name.toLowerCase().includes(term)));
    return [...watched.filter((o) => !term || o.name.toLowerCase().includes(term)), ...others.slice(0, 50)];
  })();
  const setBreakdown = (index, change) => {
    setSaved(false);
    setDraft((d) => ({ ...d, breakdowns: d.breakdowns.map((b, i) => (i === index ? { ...b, ...change } : b)) }));
  };

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
      <Card title="Breakdown fields" description={`Reports show tickets and each issue split by these fields, for example base or device type. Up to ${MAX_BREAKDOWNS}.`}>
        <div className="nq-stack">
          {draft.breakdowns.map((b, index) => <div className="cs-row" key={index}>
            <Field label="Field" htmlFor={`cs-field-${index}`}>
              <select id={`cs-field-${index}`} className="nq-select" value={b.id}
                onChange={(e) => setBreakdown(index, { id: e.target.value, label: fieldName(e.target.value) })}>
                {state.fields.map((f) => <option key={f.id} value={f.id}
                  disabled={f.id !== b.id && draft.breakdowns.some((x) => x.id === f.id)}>{f.name}</option>)}
              </select>
            </Field>
            <Field label="Shown as" htmlFor={`cs-label-${index}`}>
              <input id={`cs-label-${index}`} className="nq-input" maxLength={40} value={b.label} onChange={(e) => setBreakdown(index, { label: e.target.value })} />
            </Field>
            <label className="cs-check cs-portal" title="Customers see this breakdown in published portal reports">
              <input type="checkbox" className="nq-check" checked={b.portal === true} onChange={(e) => setBreakdown(index, { portal: e.target.checked })} />
              <span>Show on portal</span>
            </label>
            <Button appearance="subtle" small onClick={() => { setSaved(false); setDraft((d) => ({ ...d, breakdowns: d.breakdowns.filter((_, i) => i !== index) })); }}>Remove</Button>
          </div>)}
          {!draft.breakdowns.length && <p className="nq-muted">No breakdown fields yet. Reports still show patterns and trends.</p>}
          {draft.breakdowns.length < MAX_BREAKDOWNS && state.fields.length > 0 && <div>
            <Button small onClick={() => {
              setSaved(false);
              const next = state.fields.find((f) => !draft.breakdowns.some((b) => b.id === f.id));
              if (next) setDraft((d) => ({ ...d, breakdowns: [...d.breakdowns, { id: next.id, label: next.name }] }));
            }}>Add a field</Button>
          </div>}
          <p className="nq-muted">Only fields that hold choices can be used: select lists, checkboxes, radio buttons, cascading selects, labels, components, priority and request type.</p>
        </div>
      </Card>

      <CrewNumbers headcounts={draft.headcounts || []} organizations={state.organizations || []} breakdowns={state.settings.breakdowns} portalEnabled={draft.portalEnabled === true}
        onChange={(headcounts) => { setSaved(false); setDraft((d) => ({ ...d, headcounts })); }} />

      <Card title="Patterns" description="How tickets are grouped into recurring issues.">
        <Field label="Minimum tickets per pattern" htmlFor="cs-min-pattern"
          help={`Between ${MIN_PATTERN.min} and ${MIN_PATTERN.max}. Higher numbers show fewer, more established issues. For large customers this counts tickets in the analysed sample.`}>
          <input id="cs-min-pattern" className="nq-input cs-number" type="number" min={MIN_PATTERN.min} max={MIN_PATTERN.max} step={1}
            value={draft.minPatternSize ?? MIN_PATTERN.default}
            onChange={(e) => { setSaved(false); setDraft((d) => ({ ...d, minPatternSize: Number(e.target.value) })); }} />
        </Field>
        <Field label="Words that mean the same" htmlFor="cs-synonyms"
          help={`One list per line, for example “pinpad = bluepad, pin pad, card reader”. Tickets using any of them group together under the first word. Up to ${SYNONYM_LIMITS.groups} lines; capital letters, hyphens and plurals don’t matter.`}>
          <textarea id="cs-synonyms" className="nq-textarea" rows={5}
            value={synonymText(draft.synonyms ?? DEFAULT_SYNONYMS)}
            onChange={(e) => { setSaved(false); setDraft((d) => ({ ...d, synonyms: e.target.value })); }} />
        </Field>
      </Card>

      <Card title="Data quality" description="Breakdown values that mean nobody filled the field in. Reports count them, with tickets that have no value, so you can track the clean-up.">
        <Field label="Placeholder values" htmlFor="cs-placeholders"
          help={`One per line or separated by commas, up to ${MAX_PLACEHOLDERS}. Matching ignores capital letters and extra spaces.`}>
          <textarea id="cs-placeholders" className="nq-textarea" rows={4}
            value={Array.isArray(draft.placeholders) ? draft.placeholders.join('\n') : (draft.placeholders ?? DEFAULT_PLACEHOLDERS.join('\n'))}
            onChange={(e) => { setSaved(false); setDraft((d) => ({ ...d, placeholders: e.target.value })); }} />
        </Field>
      </Card>

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

      <ActionBar state={saving ? 'Saving…' : dirty ? 'Unsaved changes' : saved ? 'Saved' : ''}>
        <Button appearance="subtle" disabled={!dirty || saving} onClick={() => { setDraft(state.settings); setSaved(false); }}>Discard</Button>
        <Button appearance="primary" disabled={!dirty || saving} onClick={save}>Save</Button>
      </ActionBar>

      <PdfLogos invoke={invoke} organizations={state.organizations || []} />

      <BackupRestore invoke={invoke} app="Customer Insights" filePrefix="retailinmotion-customer-insights" />
    </>}
    <Footer product={PRODUCT} version={version} />
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
