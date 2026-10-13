// Settings → Customers → Devices: the device ID and type fields, device types
// (how many per crew member, which field values count) and P1/P2 thresholds.
import React from 'react';
import { Button, Card, Field } from '@retailinmotion/ui/react';
import { DEFAULT_DEVICES, DEVICE_LIMITS } from '../../../src/devices.js';

export default function DeviceSettings({ value, onChange, idChoices = [], fields = [] }) {
  const d = { ...DEFAULT_DEVICES, ...value };
  const set = (change) => onChange({ ...d, ...change });
  const setType = (i, change) => set({ types: d.types.map((t, n) => (n === i ? { ...t, ...change } : t)) });
  return <Card title="Devices" description="Count how many devices recurring issues and live surges affect, against the fleet (worked out from crew numbers for now), and suggest a priority from the share affected. Agents decide the actual priority.">
    <div className="nq-stack">
      <div className="cs-row cs-row--pair">
        <Field label="Device ID field" htmlFor="cs-dev-id" help="The ticket field with the device's serial, asset tag or name. Each distinct value is one device.">
          <select id="cs-dev-id" className="nq-select" value={d.idFieldId} onChange={(e) => set({ idFieldId: e.target.value })}>
            <option value="">Off</option>
            {idChoices.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </Field>
        <Field label="Device type field" htmlFor="cs-dev-type" help="The ticket field that says which kind of device it is (for example Device Type).">
          <select id="cs-dev-type" className="nq-select" value={d.typeFieldId} onChange={(e) => set({ typeFieldId: e.target.value })}>
            <option value="">None</option>
            {fields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </Field>
      </div>
      <div>
        <strong>Device types</strong>
        <p className="nq-muted">How many of each device a crew member has, and the device type values (or words in them) that mean this device.</p>
        {d.types.map((t, i) => <div className="cs-row cs-dev-row" key={i}>
          <Field label="Name" htmlFor={`cs-dev-label-${i}`}>
            <input id={`cs-dev-label-${i}`} className="nq-input" maxLength={40} value={t.label} onChange={(e) => setType(i, { label: e.target.value })} />
          </Field>
          <Field label="Per crew member" htmlFor={`cs-dev-per-${i}`}>
            <input id={`cs-dev-per-${i}`} className="nq-input cs-number" type="number" min={0} max={20} step={0.5} value={t.perCrew} onChange={(e) => setType(i, { perCrew: Number(e.target.value) })} />
          </Field>
          <Field label="Matching values" htmlFor={`cs-dev-values-${i}`}>
            <input id={`cs-dev-values-${i}`} className="nq-input" value={Array.isArray(t.values) ? t.values.join(', ') : t.values} onChange={(e) => setType(i, { values: e.target.value })} />
          </Field>
          <Button appearance="subtle" small onClick={() => set({ types: d.types.filter((_, n) => n !== i) })}>Remove</Button>
        </div>)}
        {d.types.length < DEVICE_LIMITS.types && <Button small onClick={() => set({ types: [...d.types, { label: '', perCrew: 1, values: '' }] })}>Add a device type</Button>}
      </div>
      <div className="cs-row cs-row--pair">
        <Field label="Suggest P1 from (% of a fleet)" htmlFor="cs-dev-p1">
          <input id="cs-dev-p1" className="nq-input cs-number" type="number" min={1} max={100} value={d.p1Percent} onChange={(e) => set({ p1Percent: Number(e.target.value) })} />
        </Field>
        <Field label="Suggest P2 from (% of a fleet)" htmlFor="cs-dev-p2">
          <input id="cs-dev-p2" className="nq-input cs-number" type="number" min={1} max={100} value={d.p2Percent} onChange={(e) => set({ p2Percent: Number(e.target.value) })} />
        </Field>
      </div>
    </div>
  </Card>;
}
