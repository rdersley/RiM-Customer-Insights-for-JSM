// Settings → Internal. The default internal settings, plus settings for
// particular projects (IT Help, SD…): client fields, breakdown fields, SLAs,
// patterns and data quality. An analysis whose projects all share one set of
// project settings uses them; anything else uses the default.
import React, { useEffect, useState } from 'react';
import { Button, Card, Field, Notice } from '@retailinmotion/ui/react';
import { DEFAULT_INTERNAL_SYNONYMS, DEFAULT_SETTINGS, MAX_BREAKDOWNS, MAX_CLIENT_FIELDS, MAX_PROJECT_PROFILES } from '../../../src/settings.js';
import BreakdownFields from './BreakdownFields.jsx';
import PatternSettings from './PatternSettings.jsx';
import SlaSettings from './SlaSettings.jsx';

const ids = (list) => (list || []).map((x) => x.id ?? x);

function ClientFields({ value, fields, onChange }) {
  const [search, setSearch] = useState('');
  const chosen = ids(value);
  const term = search.trim().toLowerCase();
  const usable = fields.filter((f) => /^customfield_/.test(f.id) && ['option', 'options', 'cascading', 'strings'].includes(f.kind));
  // Ticked fields first, then matches for the search.
  const shown = [...usable.filter((f) => chosen.includes(f.id)), ...usable.filter((f) => !chosen.includes(f.id) && (!term || f.name.toLowerCase().includes(term)))];
  return <Card title="Client fields" description="The fields that hold the client, so an analysis can be narrowed to a client and broken down by client.">
    <Field label={`Client fields (up to ${MAX_CLIENT_FIELDS})`} htmlFor="cs-client-fields"
      help="Select lists, checkboxes, cascading selects and labels can be used. A ticket's client is read from whichever of these it has.">
      <input className="nq-input cs-field-search" placeholder="Search fields" aria-label="Search client fields" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="cs-orgs" id="cs-client-fields">{shown.map((f) => {
        const on = chosen.includes(f.id);
        return <label className="cs-check" key={f.id}>
          <input type="checkbox" className="nq-check" checked={on} disabled={!on && chosen.length >= MAX_CLIENT_FIELDS}
            onChange={(e) => onChange(e.target.checked ? [...chosen, f.id] : chosen.filter((id) => id !== f.id))} />
          <span>{f.name}</span>
        </label>;
      })}</div>
    </Field>
  </Card>;
}

export default function InternalSettings({ draft, update, fields, slaChoices, invoke }) {
  const [selected, setSelected] = useState('default');
  const [projects, setProjects] = useState(null);
  const [newName, setNewName] = useState('');
  useEffect(() => { invoke('getProjects').then((r) => setProjects(r.projects || [])).catch(() => setProjects([])); }, [invoke]);

  const profiles = draft.projectProfiles || [];
  const profile = profiles.find((p) => p.id === selected) || null;
  const used = new Set(profiles.flatMap((p) => p.projects));
  const projectName = (key) => projects?.find((p) => p.key === key)?.name || key;
  const setProfile = (change) => update((d) => ({ ...d, projectProfiles: (d.projectProfiles || []).map((p) => (p.id === selected ? { ...p, ...change } : p)) }));

  // What the cards below edit: the default internal settings, or the chosen project settings.
  const current = profile
    ? { clientFields: profile.clientFields, breakdowns: profile.breakdowns, slaFields: profile.slaFields, patterns: { ...DEFAULT_SETTINGS.internalPatterns, ...profile.patterns } }
    : { clientFields: draft.clientFields, breakdowns: draft.internalBreakdowns, slaFields: draft.slaFields, patterns: { ...DEFAULT_SETTINGS.internalPatterns, ...draft.internalPatterns } };
  const set = (key, value) => {
    if (profile) setProfile({ [key]: value });
    else update((d) => ({ ...d, [{ clientFields: 'clientFields', breakdowns: 'internalBreakdowns', slaFields: 'slaFields', patterns: 'internalPatterns' }[key]]: value }));
  };

  function addProfile() {
    const name = newName.trim();
    if (!name) return;
    const id = `p-${Date.now().toString(36)}`;
    // Starts as a copy of the default internal settings.
    update((d) => ({ ...d, projectProfiles: [...(d.projectProfiles || []), { id, name, projects: [], clientFields: ids(d.clientFields), breakdowns: d.internalBreakdowns || [], slaFields: ids(d.slaFields), patterns: { ...DEFAULT_SETTINGS.internalPatterns, ...d.internalPatterns } }] }));
    setSelected(id); setNewName('');
  }

  return <>
    <Card title="Project settings" description="Internal reports use the default settings below, or the settings for their projects. Give projects their own settings when they use different fields, SLAs or wording (for example IT Help and Service Desk). An analysis uses a project's settings when every project in it shares them.">
      <div className="nq-stack">
        <div className="cs-row cs-row--pair">
          <Field label="Editing" htmlFor="cs-profile">
            <select id="cs-profile" className="nq-select" value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="default">Default (all other projects)</option>
              {profiles.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.projects.join(', ') || 'no projects yet'})</option>)}
            </select>
          </Field>
          {profiles.length < MAX_PROJECT_PROFILES && <Field label="Add project settings" htmlFor="cs-profile-new">
            <div className="ci-picker">
              <input id="cs-profile-new" className="nq-input" placeholder="Name, e.g. IT Help" maxLength={60} value={newName} onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addProfile(); } }} />
              <Button small onClick={addProfile} disabled={!newName.trim()}>Add</Button>
            </div>
          </Field>}
        </div>
        {profile && <>
          <Field label="Name" htmlFor="cs-profile-name">
            <input id="cs-profile-name" className="nq-input" maxLength={60} value={profile.name} onChange={(e) => setProfile({ name: e.target.value })} />
          </Field>
          <Field label="Projects" htmlFor="cs-profile-projects" help="A project can have one set of settings. Projects not listed in any use the default.">
            <select id="cs-profile-projects" className="nq-select" value="" disabled={!projects}
              onChange={(e) => { const key = e.target.value; if (key) setProfile({ projects: [...profile.projects, key] }); }}>
              <option value="">{projects ? 'Add a project…' : 'Loading projects…'}</option>
              {(projects || []).filter((p) => !used.has(p.key)).map((p) => <option key={p.key} value={p.key}>{p.name} ({p.key})</option>)}
            </select>
          </Field>
          <div className="cs-chips">{profile.projects.map((key) => <span className="cs-chip" key={key}>{projectName(key)}
            <button type="button" className="cs-chip__remove" aria-label={`Remove ${key}`} onClick={() => setProfile({ projects: profile.projects.filter((k) => k !== key) })}>×</button>
          </span>)}</div>
          {!profile.projects.length && <Notice>Add at least one project, or these settings aren’t saved.</Notice>}
          <div><Button small appearance="subtle" onClick={() => { update((d) => ({ ...d, projectProfiles: (d.projectProfiles || []).filter((p) => p.id !== selected) })); setSelected('default'); }}>Delete these project settings</Button></div>
        </>}
      </div>
    </Card>

    <ClientFields value={current.clientFields} fields={fields} onChange={(v) => set('clientFields', v)} />

    <BreakdownFields id={`cs-ibd-${selected}`} title="Breakdown fields" fields={fields}
      description={`Internal reports show tickets and each issue split by these fields, for example team, component or category. Project and Client are added automatically. Up to ${MAX_BREAKDOWNS}.`}
      list={current.breakdowns || []} onChange={(v) => set('breakdowns', v)} />

    <SlaSettings value={current.slaFields || []} choices={slaChoices} scope={profile ? 'project' : 'default'} onChange={(v) => set('slaFields', v)} />

    <PatternSettings id={`cs-int-${selected}`} value={current.patterns} defaultSynonyms={DEFAULT_INTERNAL_SYNONYMS}
      onChange={(change) => set('patterns', { ...current.patterns, ...change })} />

    <Card title="Handling time (AHT)" description="Team performance shows each agent's average handling time: how long tickets were in progress while assigned to them. This applies to every report.">
      <Field label="Statuses that count as handling" htmlFor="cs-handling"
        help="One per line, for example In Progress. Leave empty to count every “in progress” status except waiting ones (Waiting for customer, Pending, On hold…).">
        <textarea id="cs-handling" className="nq-textarea" rows={3} placeholder="In Progress"
          value={Array.isArray(draft.handlingStatuses) ? draft.handlingStatuses.join('\n') : (draft.handlingStatuses || '')}
          onChange={(e) => update((d) => ({ ...d, handlingStatuses: e.target.value }))} />
      </Field>
    </Card>
  </>;
}
