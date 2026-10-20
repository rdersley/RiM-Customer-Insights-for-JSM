// Settings → Internal. The default internal settings, plus settings for
// particular projects (IT Help, SD…): client fields, breakdown fields, SLAs,
// patterns and data quality. An analysis whose projects all share one set of
// project settings uses them; anything else uses the default.
import { DEFAULT_DISPATCH } from '../../../src/dispatch.js';
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
        {/* Escalation levels and hardware dispatch are set per project: show where they are. */}
        {!profile && profiles.length > 0 && <div className="nq-table-wrap">
          <table className="nq-table cs-profiles">
            <thead><tr><th>Project settings</th><th>Projects</th><th>Escalation levels</th><th>Hardware dispatch</th><th /></tr></thead>
            <tbody>{profiles.map((p) => <tr key={p.id}>
              <td><strong>{p.name}</strong></td>
              <td>{p.projects.join(', ') || '–'}</td>
              <td>{p.escalation?.enabled ? 'On' : 'Off'}</td>
              <td>{p.dispatch?.enabled ? `On, ${p.dispatch.targetHours || 48} h target` : 'Off'}</td>
              <td><Button small onClick={() => setSelected(p.id)}>Open</Button></td>
            </tr>)}</tbody>
          </table>
        </div>}
        {!profile && <p className="nq-muted">Escalation levels and Hardware dispatch are set for a project, not here: open its settings above, or add settings for it (for example “Hardware” with HW) to switch them on.</p>}
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

    {profile && <Card title="Escalation levels" description={`Internal reports for ${profile.name} show what support level tickets reach and how long they take to get to 2nd and 3rd level, from their status history.`}>
      <div className="nq-stack">
        <label className="cs-check">
          <input type="checkbox" className="nq-check" checked={profile.escalation?.enabled === true}
            onChange={(e) => setProfile({ escalation: { ...profile.escalation, enabled: e.target.checked } })} />
          <span>Show escalation levels for these projects</span>
        </label>
        {profile.escalation?.enabled && ['1st level', '2nd level', '3rd level'].map((label, i) => <Field key={label} label={`${label} statuses`} htmlFor={`cs-esc-${i}`}
          help={i === 0 ? 'One per line, for example In Progress 1st Level. Leave all three empty to recognise levels from status names (1st/first, 2nd/second, 3rd/third).' : undefined}>
          <textarea id={`cs-esc-${i}`} className="nq-textarea" rows={2}
            value={Array.isArray(profile.escalation?.levels?.[i]) ? profile.escalation.levels[i].join('\n') : (profile.escalation?.levels?.[i] || '')}
            onChange={(e) => { const levels = [0, 1, 2].map((n) => (n === i ? e.target.value : profile.escalation?.levels?.[n] || [])); setProfile({ escalation: { ...profile.escalation, levels } }); }} />
        </Field>)}
      </div>
    </Card>}

    {profile && <Card title="Hardware dispatch" description={`Internal reports for ${profile.name} show how long devices take to be sent against a target, the queue waiting now, and devices not yet returned, by device type.`}>
      <div className="nq-stack">
        <label className="cs-check">
          <input type="checkbox" className="nq-check" checked={profile.dispatch?.enabled === true}
            onChange={(e) => setProfile({ dispatch: { ...DEFAULT_DISPATCH, ...profile.dispatch, enabled: e.target.checked } })} />
          <span>Show hardware dispatch for these projects</span>
        </label>
        {profile.dispatch?.enabled && <>
          <div className="cs-row cs-row--pair">
            <Field label="Device type field" htmlFor="cs-disp-device" help="Splits every figure by device, for example Device Type.">
              <select id="cs-disp-device" className="nq-select" value={profile.dispatch.deviceFieldId || ''} onChange={(e) => setProfile({ dispatch: { ...profile.dispatch, deviceFieldId: e.target.value } })}>
                <option value="">None</option>
                {fields.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </Field>
            <Field label="Target (hours)" htmlFor="cs-disp-target" help="From the request to the device being sent.">
              <input id="cs-disp-target" className="nq-input cs-number" type="number" min={1} max={2000} value={profile.dispatch.targetHours ?? 48}
                onChange={(e) => setProfile({ dispatch: { ...profile.dispatch, targetHours: Number(e.target.value) } })} />
            </Field>
          </div>
          {[['queueStatuses', 'Waiting to be sent', 'Open'], ['sentStatuses', 'Sent (first move here counts as dispatched)', 'Dispatched to Customer\nWaiting Device Return'], ['returnStatuses', 'Sent, waiting for the old device back (optional)', 'Waiting Device Return']].map(([key, label, placeholder]) => <Field key={key} label={`${label} statuses`} htmlFor={`cs-disp-${key}`} help={key === 'queueStatuses' ? 'One per line.' : undefined}>
            <textarea id={`cs-disp-${key}`} className="nq-textarea" rows={2} placeholder={placeholder}
              value={Array.isArray(profile.dispatch[key]) ? profile.dispatch[key].join('\n') : (profile.dispatch[key] || '')}
              onChange={(e) => setProfile({ dispatch: { ...profile.dispatch, [key]: e.target.value } })} />
          </Field>)}
        </>}
      </div>
    </Card>}

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
