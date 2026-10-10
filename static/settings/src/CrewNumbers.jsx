// Settings → Crew numbers. The admin picks the organisations a crew list covers
// (one customer often has several, such as Crew, Hardware and Head Office) and
// the breakdown field that holds the base, then chooses the crew list. The file is
// read here in the browser; only the number of crew per base is saved.
import React, { useState } from 'react';
import { Button, Card, Field, Notice } from '@retailinmotion/ui/react';
import { crewFromFile, MAX_HEADCOUNT_ORGS, MAX_HEADCOUNTS, orgsOf } from '../../../src/headcount.js';

const n = (value) => Number(value || 0).toLocaleString();
const day = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');

async function readCrew(file) {
  if (file.size > 20 * 1024 * 1024) throw new Error('That file is over 20 MB.');
  return crewFromFile(await file.text());
}

export default function CrewNumbers({ headcounts = [], onChange, organizations = [], breakdowns = [], portalEnabled }) {
  const [orgFilter, setOrgFilter] = useState('');
  const [picked, setPicked] = useState([]); // organisations for a new crew list
  const [fieldId, setFieldId] = useState('');
  const [parsed, setParsed] = useState(null);
  const [error, setError] = useState('');
  const [inputKey, setInputKey] = useState(0);

  const fieldLabel = (id) => breakdowns.find((b) => b.id === id)?.label || 'a field that is no longer a breakdown';
  const update = (index, change) => onChange(headcounts.map((h, i) => (i === index ? { ...h, ...change } : h)));
  const term = orgFilter.trim().toLowerCase();
  // An organisation belongs to one crew list.
  const used = new Set(headcounts.flatMap((h) => orgsOf(h).map((o) => String(o.id))));
  const free = organizations.filter((o) => !used.has(String(o.id)));
  const choices = [...free.filter((o) => picked.includes(o.id)), ...free.filter((o) => !picked.includes(o.id) && (!term || o.name.toLowerCase().includes(term))).slice(0, 50)];
  const setOrgs = (index, list) => update(index, { organizations: list, organization: undefined });
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
    const chosen = organizations.filter((o) => picked.includes(o.id)).map((o) => ({ id: o.id, name: o.name }));
    if (!chosen.length || !parsed || !field) return;
    onChange([...headcounts, { organizations: chosen, fieldId: field, values: parsed.values, source: parsed.source, updatedAt: new Date().toISOString(), portal: false }]);
    setParsed(null); setPicked([]); setOrgFilter(''); setInputKey((k) => k + 1);
  }

  return <Card title="Crew numbers" description="Compare tickets with the number of crew: reports show tickets per 100 crew overall and for each base, so a small base with lots of issues stands out next to a big one.">
    <div className="nq-stack">
      {error && <Notice kind="error">{error}</Notice>}
      {headcounts.map((h, index) => {
        const crew = h.values.reduce((t, v) => t + v.count, 0);
        const listOrgs = orgsOf(h);
        return <div className="cs-crew" key={listOrgs.map((o) => o.id).join('-')}>
          <div>
            <div className="cs-chips">
              {listOrgs.map((o) => <span className="cs-chip" key={o.id}>{o.name}
                {listOrgs.length > 1 && <button type="button" className="cs-chip__remove" aria-label={`Remove ${o.name}`} onClick={() => setOrgs(index, listOrgs.filter((x) => x.id !== o.id))}>×</button>}
              </span>)}
              {listOrgs.length < MAX_HEADCOUNT_ORGS && free.length > 0 && <select className="nq-select cs-chip__add" aria-label="Add an organisation to this crew list" value=""
                onChange={(e) => { const o = free.find((x) => x.id === e.target.value); if (o) setOrgs(index, [...listOrgs, { id: o.id, name: o.name }]); }}>
                <option value="">+ Add organisation</option>
                {free.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>}
            </div>
            <p className="nq-muted">{n(crew)} crew at {h.values.length} {h.values.length === 1 ? 'base' : 'bases'}, matched to {fieldLabel(h.fieldId)}. {h.source ? `From ${h.source}, ` : ''}updated {day(h.updatedAt)}.</p>
            <p className="nq-muted cs-crew__top">{h.values.slice(0, 8).map((v) => `${v.value} ${n(v.count)}`).join(' · ')}{h.values.length > 8 ? ' …' : ''}</p>
          </div>
          <div className="nq-inline cs-crew__actions">
            <label className="cs-check cs-portal" title={portalEnabled ? 'Customers see requests per 100 crew in these organisations’ portal reports' : 'Turn on the customer portal below first'}>
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
          <Field label={`Organisations (up to ${MAX_HEADCOUNT_ORGS})`} htmlFor="cs-crew-org-filter"
            help="Tick every organisation these crew raise tickets from. Reports for any of them, alone or together, then show tickets per 100 crew.">
            <input id="cs-crew-org-filter" className="nq-input" placeholder="Search organisations" value={orgFilter} onChange={(e) => setOrgFilter(e.target.value)} />
            <div className="cs-orgs">{choices.map((o) => {
              const on = picked.includes(o.id);
              return <label className="cs-check" key={o.id}>
                <input type="checkbox" className="nq-check" checked={on} disabled={!on && picked.length >= MAX_HEADCOUNT_ORGS}
                  onChange={(e) => setPicked((p) => (e.target.checked ? [...p, o.id] : p.filter((id) => id !== o.id)))} />
                <span>{o.name}</span>
              </label>;
            })}{!choices.length && <span className="nq-muted">No organisations left to add.</span>}</div>
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
        <div><Button small disabled={!parsed || !picked.length} onClick={add}>Add crew numbers</Button></div>
      </div>}
      <p className="nq-muted">Save to apply. Upload a new file whenever crew numbers change; reports say when they were last updated.</p>
    </div>
  </Card>;
}
