// Settings → SLAs: which JSM SLA fields reports measure (customer reports,
// internal reports, or a project's internal reports). None ticked: no SLA section.
import React from 'react';
import { Card } from '@retailinmotion/ui/react';
import { MAX_SLA_FIELDS } from '../../../src/sla.js';

export default function SlaSettings({ value = [], choices = [], onChange, scope = 'default' }) {
  const chosen = value.map((x) => x.id ?? x);
  const who = { project: 'Internal reports for these projects', customers: 'Customer reports', default: 'Internal reports without project settings' }[scope] || 'Reports';
  return <Card title="SLAs" description={`${who} show how tickets did against these service project SLAs: the share met, the recurring issues that breach most, and the breakdown values with the highest breach rate. Up to ${MAX_SLA_FIELDS}. Tick none to leave SLAs out.`}>
    {choices.length
      ? <div className="cs-orgs">{choices.map((f) => {
        const on = chosen.includes(f.id);
        return <label className="cs-check" key={f.id}>
          <input type="checkbox" className="nq-check" checked={on} disabled={!on && chosen.length >= MAX_SLA_FIELDS}
            onChange={(e) => onChange(e.target.checked ? [...chosen, f.id] : chosen.filter((id) => id !== f.id))} />
          <span>{f.name}</span>
        </label>;
      })}</div>
      : <p className="nq-muted">This site has no service project SLAs.</p>}
  </Card>;
}
