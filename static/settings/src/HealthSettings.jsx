// Settings → Customer health (src/health.js, healthJobs.js): which organisations
// are on the all-customers health list. Off until an admin turns it on.
import React, { useState } from 'react';
import { invoke } from '@forge/bridge';
import { Button, Card, Field } from '@retailinmotion/ui/react';
import { DEFAULT_HEALTH, HEALTH_SIGNALS, MAX_HEALTH_ORGS } from '../../../src/health.js';

export default function HealthSettings({ value, onChange, organizations = [], canRefresh = false }) {
  const health = { ...DEFAULT_HEALTH, ...value };
  const set = (change) => onChange({ ...health, ...change });
  const [filter, setFilter] = useState('');
  const [note, setNote] = useState('');
  const term = filter.trim().toLowerCase();
  const listed = health.organizations;
  const shown = [...listed.filter((o) => !term || o.name.toLowerCase().includes(term)),
    ...organizations.filter((o) => !listed.some((w) => w.id === o.id) && (!term || o.name.toLowerCase().includes(term))).slice(0, 50)];

  return <Card title="Customer health" description="A 0–100 health score for each organisation, worked out once a day from the last 30 days, with a ranked list on the Customer Insights page. Reports for any organisation also show their score. Internal only: never on the portal or in emails to customers.">
    <div className="nq-stack">
      <p className="nq-muted">Signals: {HEALTH_SIGNALS.map((s) => `${s.label} (${s.weight}%)`).join(', ')}. A signal without enough data is left out and the others are weighted up.</p>
      <label className="cs-check">
        <input type="checkbox" className="nq-check" checked={health.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        <span>Turn on the customer health list</span>
      </label>
      {health.enabled && <>
        <Field label={`Organisations on the list (${listed.length} of ${MAX_HEALTH_ORGS})`} htmlFor="cs-health-filter">
          <input id="cs-health-filter" className="nq-input" placeholder="Search organisations" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="cs-orgs">{shown.map((o) => {
            const on = listed.some((w) => w.id === o.id);
            return <label className="cs-check" key={o.id}>
              <input type="checkbox" className="nq-check" checked={on} disabled={!on && listed.length >= MAX_HEALTH_ORGS}
                onChange={(e) => set({ organizations: e.target.checked ? [...listed, { id: o.id, name: o.name }] : listed.filter((w) => w.id !== o.id) })} />
              <span>{o.name}</span>
            </label>;
          })}</div>
        </Field>
        <div className="nq-spread">
          <span className="nq-muted">{note || 'Scores update once a day, from 05:00 UTC.'}</span>
          <Button small disabled={!canRefresh || !listed.length}
            onClick={async () => {
              setNote('Queuing…');
              try { const { queued } = await invoke('refreshHealth'); setNote(`Working out ${queued} score${queued === 1 ? '' : 's'} now. They appear within a few minutes.`); }
              catch (e) { setNote(e.message || 'The refresh couldn’t be started.'); }
            }}>Refresh now</Button>
        </div>
      </>}
    </div>
  </Card>;
}
