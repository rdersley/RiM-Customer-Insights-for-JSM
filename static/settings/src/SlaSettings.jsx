// Settings → Internal → SLAs: which JSM SLA fields reports measure.
import React from 'react';
import { Card } from '@retailinmotion/ui/react';
import { MAX_SLA_FIELDS } from '../../../src/sla.js';

export default function SlaSettings({ value = [], choices = [], onChange }) {
  const chosen = value.map((x) => x.id ?? x);
  return <Card title="SLAs" description={`Reports on both tabs show how tickets did against these service project SLAs: the share met, the recurring issues that breach most, and the breakdown values (such as teams) with the highest breach rate. Up to ${MAX_SLA_FIELDS}.`}>
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
