// Settings → Crew numbers. The admin picks an organisation and the breakdown
// field that holds the base, then chooses the customer's crew list. The file is
// read here in the browser; only the number of crew per base is saved.
import React, { useState } from 'react';
import { Button, Card, Field, Notice } from '@retailinmotion/ui/react';
import { crewFromFile, MAX_HEADCOUNTS } from '../../../src/headcount.js';

const n = (value) => Number(value || 0).toLocaleString();
const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

async function readCrew(file) {
  if (file.size > 20 * 1024 * 1024) throw new Error('That file is over 20 MB.');
  return crewFromFile(await file.text());
}

export default function CrewNumbers({ headcounts = [], onChange, organizations = [], breakdowns = [], portalEnabled }) {
  const [orgFilter, setOrgFilter] = useState('');
  const [orgId, setOrgId] = useState('');
  const [fieldId, setFieldId] = useState('');
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState('');
  const [inputKey, setInputKey] = useState(0);

  const fieldLabel = (id) => breakdowns.find((b) => b.id === id)?.label || 'a field that is no longer a breakdown';
  const update = (index, change) => onChange(headcounts.map((h, i) => (i === index ? { ...h, ...change } : h)));
  const term = orgFilter.trim().toLowerCase();
  const choices = organizations.filter((o) => !headcounts.some((h) => h.organization.id === o.id) && (!term || o.name.toLowerCase().includes(term))).slice(0, 50);
  const field = fieldId || breakdowns.find((b) => /base|location/i.test(b.label))?.id || breakdowns[0]?.id || '';

  async function choose(file) {
    setError(''); setParsed(null);
    if (!file) return;
    try { setParsed({ ...(await readCrew(file)), source: file.name }); } catch (e) { setError(e.message || 'The file could not be read.'); }
  }

  async function replace(index, file) {
    setError('');
    if (!file) return;
    try {
      const result = await readCrew(file);
      update(index, { values: result.values, source: file.name, updatedAt: new Date().toISOString() });
    } catch (e) { setError(e.message || 'The file could not be read.'); }
  }

  function add() {
    const organization = organizations.find((o) => o.id === (orgId || choices[0]?.id));
    if (!organization || !parsed || !field) return;
    onChange([...headcounts, { organization: { id: organization.id, name: organization.name }, fieldId: field, values: parsed.values, source: parsed.source, updatedAt: new Date().toISOString(), portal: false }]);
    setParsed(null); setOrgId(''); setOrgFilter(''); setInputKey((k) => k + 1);
  }

  return <Card title="Crew numbers" description="Compare tickets with the number of crew: reports show tickets per 100 crew overall and for each base, so a small base with lots of issues stands out next to a big one.">
    <div className="nq-stack">
      {error && <Notice kind="error">{error}</Notice>}
      {headcounts.map((h, index) => {
        const crew = h.values.reduce((t, v) => t + v.count, 0);
        return <div className="cs-crew" key={h.organization.id}>
          <div>
            <strong>{h.organization.name}</strong>
            <p className="nq-muted">{n(crew)} crew at {h.values.length} {h.values.length === 1 ? 'base' : 'bases'}, matched to {fieldLabel(h.fieldId)}. {h.source ? `From ${h.source}, ` : ''}updated {day(h.updatedAt)}.</p>
            <p className="nq-muted cs-crew__top">{h.values.slice(0, 8).map((v) => `${v.value} ${n(v.count)}`).join(' · ')}{h.values.length > 8 ? ' …' : ''}</p>
          </div>
          <div className="nq-inline cs-crew__actions">
            <label className="cs-check cs-portal" title={portalEnabled ? 'Customers see tickets per 100 crew in this organisation’s portal report' : 'Turn on the customer portal below first'}>
              <input type="checkbox" className="nq-check" checked={h.portal === true} disabled={!portalEnabled} onChange={(e) => update(index, { portal: e.target.checked })} />
              <span>Show on portal</span>
            </label>
            <label className="nq-btn nq-btn--small cs-file">Replace file<input type="file" accept=".csv,.txt" onChange={(e) => replace(index, e.target.files?.[0])} /></label>
            <Button appearance="subtle" small onClick={() => onChange(headcounts.filter((_, i) => i !== index))}>Remove</Button>
          </div>
        </div>;
      })}
      {!headcounts.length && <p className="nq-muted">No crew numbers yet.</p>}

      {!breakdowns.length && <Notice>Add a breakdown field that holds the base (for example “Base or Location”) first, then save.</Notice>}
      {breakdowns.length > 0 && headcounts.length < MAX_HEADCOUNTS && <div className="nq-stack cs-crew__add">
        <div className="cs-row cs-row--pair">
          <Field label="Organisation" htmlFor="cs-crew-org-filter">
            <input id="cs-crew-org-filter" className="nq-input" placeholder="Search organisations" value={orgFilter} onChange={(e) => { setOrgFilter(e.target.value); setOrgId(''); }} />
            <select className="nq-select" aria-label="Organisation" value={orgId || choices[0]?.id || ''} onChange={(e) => setOrgId(e.target.value)}>
              {choices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>
          <Field label="Base field" htmlFor="cs-crew-field" help="The breakdown field whose values are the bases in the file.">
            <select id="cs-crew-field" className="nq-select" value={field} onChange={(e) => setFieldId(e.target.value)}>
              {breakdowns.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Crew list" htmlFor="cs-crew-file"
          help="A CSV export with one row per crew member and a Base column (people who have left or moved base are skipped), or lines of “base, number of crew”. The file is read on this computer: only the number of crew per base is saved, never names or contact details.">
          <input key={inputKey} id="cs-crew-file" type="file" accept=".csv,.txt" className="nq-input" onChange={(e) => choose(e.target.files?.[0])} />
        </Field>
        {parsed && <Notice kind="success">
          {n(parsed.total)} crew at {parsed.values.length} bases{parsed.skipped ? ` (${n(parsed.skipped)} rows skipped: left or not at that base today)` : ''}. Largest: {parsed.values.slice(0, 5).map((v) => `${v.value} ${n(v.count)}`).join(', ')}.
        </Notice>}
        <div><Button small disabled={!parsed || !choices.length} onClick={add}>Add crew numbers</Button></div>
      </div>}
      <p className="nq-muted">Save to apply. Upload a new file whenever crew numbers change; reports say when they were last updated.</p>
    </div>
  </Card>;
}
