// A list of breakdown fields (customer or internal reports): field, label and,
// for customer reports, whether the portal shows it.
import React from 'react';
import { Button, Card, Field } from '@retailinmotion/ui/react';
import { MAX_BREAKDOWNS } from '../../../src/settings.js';

export default function BreakdownFields({ id, title, description, list = [], onChange, fields = [], showPortal = false }) {
  const name = (fieldId) => fields.find((f) => f.id === fieldId)?.name || '';
  const set = (index, change) => onChange(list.map((b, i) => (i === index ? { ...b, ...change } : b)));
  return <Card title={title} description={description}>
    <div className="nq-stack">
      {list.map((b, index) => <div className={showPortal ? 'cs-row' : 'cs-row cs-row--noportal'} key={index}>
        <Field label="Field" htmlFor={`${id}-field-${index}`}>
          <select id={`${id}-field-${index}`} className="nq-select" value={b.id}
            onChange={(e) => set(index, { id: e.target.value, label: name(e.target.value) })}>
            {fields.map((f) => <option key={f.id} value={f.id} disabled={f.id !== b.id && list.some((x) => x.id === f.id)}>{f.name}</option>)}
          </select>
        </Field>
        <Field label="Shown as" htmlFor={`${id}-label-${index}`}>
          <input id={`${id}-label-${index}`} className="nq-input" maxLength={40} value={b.label} onChange={(e) => set(index, { label: e.target.value })} />
        </Field>
        {showPortal && <label className="cs-check cs-portal" title="Customers see this breakdown in published portal reports">
          <input type="checkbox" className="nq-check" checked={b.portal === true} onChange={(e) => set(index, { portal: e.target.checked })} />
          <span>Show on portal</span>
        </label>}
        <Button appearance="subtle" small onClick={() => onChange(list.filter((_, i) => i !== index))}>Remove</Button>
      </div>)}
      {!list.length && <p className="nq-muted">No breakdown fields yet. Reports still show patterns and trends.</p>}
      {list.length < MAX_BREAKDOWNS && fields.length > 0 && <div>
        <Button small onClick={() => {
          const next = fields.find((f) => !list.some((b) => b.id === f.id));
          if (next) onChange([...list, { id: next.id, label: next.name }]);
        }}>Add a field</Button>
      </div>}
      <p className="nq-muted">Only fields that hold choices can be used: select lists, checkboxes, radio buttons, cascading selects, labels, components, priority and request type.</p>
    </div>
  </Card>;
}
