// Settings → Live surge detection (src/surge.js). Off until an admin turns it on.
import React, { useState } from 'react';
import { Card, Field } from '@retailinmotion/ui/react';
import { DEFAULT_SURGE, MAX_COPY_FIELDS, MAX_SURGE_ORGS, SURGE_LIMITS } from '../../../src/surge.js';

function NumberField({ id, label, help, limits, value, onChange }) {
  return <Field label={label} htmlFor={id} help={help}>
    <input id={id} className="nq-input cs-number" type="number" min={limits.min} max={limits.max} step={1}
      value={value ?? limits.default} onChange={(e) => onChange(Number(e.target.value))} />
  </Field>;
}

export default function SurgeSettings({ value, onChange, organizations = [], breakdowns = [], fields = [] }) {
  const surge = { ...DEFAULT_SURGE, ...value };
  const set = (change) => onChange({ ...surge, ...change });
  const [filter, setFilter] = useState('');
  const term = filter.trim().toLowerCase();
  const watched = surge.organizations;
  const shown = [...watched.filter((o) => !term || o.name.toLowerCase().includes(term)),
    ...organizations.filter((o) => !watched.some((w) => w.id === o.id) && (!term || o.name.toLowerCase().includes(term))).slice(0, 50)];
  const copyable = fields.filter((f) => ['option', 'options', 'cascading', 'strings'].includes(f.kind));
  const copied = surge.copyFields.map((f) => f.id ?? f);

  return <Card title="Live surge detection" description="Every 5 minutes, look at the latest tickets from watched organisations. When lots of tickets about the same issue arrive at once, agents see an alert here and, if you choose, an incident ticket is raised with the tickets linked, ready for System Alert Manager.">
    <div className="nq-stack">
      <label className="cs-check">
        <input type="checkbox" className="nq-check" checked={surge.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        <span>Turn on live surge detection</span>
      </label>
      {surge.enabled && <>
        <Field label={`Organisations to watch (up to ${MAX_SURGE_ORGS})`} htmlFor="cs-surge-filter">
          <input id="cs-surge-filter" className="nq-input" placeholder="Search organisations" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="cs-orgs">{shown.map((o) => {
            const on = watched.some((w) => w.id === o.id);
            return <label className="cs-check" key={o.id}>
              <input type="checkbox" className="nq-check" checked={on} disabled={!on && watched.length >= MAX_SURGE_ORGS}
                onChange={(e) => set({ organizations: e.target.checked ? [...watched, { id: o.id, name: o.name }] : watched.filter((w) => w.id !== o.id) })} />
              <span>{o.name}</span>
            </label>;
          })}</div>
        </Field>
        <div className="cs-row cs-row--pair">
          <NumberField id="cs-surge-min" label="Tickets on the same issue" limits={SURGE_LIMITS.minTickets} value={surge.minTickets} onChange={(minTickets) => set({ minTickets })}
            help="At least this many in the window before anything is raised." />
          <NumberField id="cs-surge-window" label="Within (minutes)" limits={SURGE_LIMITS.windowMinutes} value={surge.windowMinutes} onChange={(windowMinutes) => set({ windowMinutes })}
            help={`Between ${SURGE_LIMITS.windowMinutes.min} and ${SURGE_LIMITS.windowMinutes.max}.`} />
          <NumberField id="cs-surge-multiple" label="Times the normal rate" limits={SURGE_LIMITS.multiple} value={surge.multiple} onChange={(multiple) => set({ multiple })}
            help="Normal is the issue's average for the same length of time over the last 7 days, so everyday issues don't trigger it." />
          <NumberField id="cs-surge-bases" label="From at least this many bases" limits={SURGE_LIMITS.minBases} value={surge.minBases} onChange={(minBases) => set({ minBases })}
            help="0 to ignore bases. Several bases at once usually means a system problem rather than a local one." />
        </div>
        <Field label="Base field" htmlFor="cs-surge-base">
          <select id="cs-surge-base" className="nq-select" value={surge.baseFieldId} onChange={(e) => set({ baseFieldId: e.target.value })}>
            <option value="">None</option>
            {breakdowns.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
        </Field>
        <label className="cs-check">
          <input type="checkbox" className="nq-check" checked={surge.createIssue} onChange={(e) => set({ createIssue: e.target.checked })} />
          <span>Raise an incident ticket for each surge</span>
        </label>
        {surge.createIssue && <>
          <div className="cs-row cs-row--pair">
            <Field label="Project key" htmlFor="cs-surge-project">
              <input id="cs-surge-project" className="nq-input" value={surge.projectKey} onChange={(e) => set({ projectKey: e.target.value.toUpperCase() })} />
            </Field>
            <Field label="Issue type" htmlFor="cs-surge-type">
              <input id="cs-surge-type" className="nq-input" value={surge.issueTypeName} onChange={(e) => set({ issueTypeName: e.target.value })} />
            </Field>
            <Field label="Priority" htmlFor="cs-surge-priority" help="System Alert Manager shows “Send System Alert” on P1 and P2 tickets in its project.">
              <input id="cs-surge-priority" className="nq-input" value={surge.priorityName} onChange={(e) => set({ priorityName: e.target.value })} />
            </Field>
          </div>
          <Field label={`Copy from the matching tickets (up to ${MAX_COPY_FIELDS})`} htmlFor="cs-surge-copy"
            help="For example the client field System Alert Manager uses to pick contacts. The most common value among the surge’s tickets is used. The Organizations field is never copied, so customers don’t see the incident ticket.">
            <div className="cs-orgs" id="cs-surge-copy">{copyable.map((f) => <label className="cs-check" key={f.id}>
              <input type="checkbox" className="nq-check" checked={copied.includes(f.id)} disabled={!copied.includes(f.id) && copied.length >= MAX_COPY_FIELDS}
                onChange={(e) => set({ copyFields: e.target.checked ? [...copied, f.id] : copied.filter((id) => id !== f.id) })} />
              <span>{f.name}</span>
            </label>)}</div>
          </Field>
          <p className="nq-muted">Tickets are created by the Customer Insights app user, labelled <code>customer-insights-surge</code>; it needs permission to create and link issues in that project. Later tickets on the same surge are linked to the same incident with a comment, for 6 hours after the last one.</p>
        </>}
      </>}
    </div>
  </Card>;
}
