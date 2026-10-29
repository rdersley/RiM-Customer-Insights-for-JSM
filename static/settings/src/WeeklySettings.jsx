// Settings → Weekly report (src/weekly.js): reports built every Monday for a
// set of organisations, broken down by the site's own category fields, and
// whether customers see the published weeks on the portal.
import React, { useState } from 'react';
import { Button, Card, Field } from '@retailinmotion/ui/react';
import { MAX_WEEKLY_ORGS, MAX_WEEKLY_REPORTS } from '../../../src/weekly.js';

const CATEGORY_KINDS = ['option', 'cascading', 'options', 'named', 'strings', 'requestType'];

function ReportEditor({ report, index, organizations, fields, onChange, onRemove }) {
  const [filter, setFilter] = useState('');
  const set = (change) => onChange({ ...report, ...change });
  const term = filter.trim().toLowerCase();
  const listed = report.organizations;
  const shown = [...listed.filter((o) => !term || o.name.toLowerCase().includes(term)),
    ...organizations.filter((o) => !listed.some((w) => w.id === o.id) && (!term || o.name.toLowerCase().includes(term))).slice(0, 50)];
  const choices = fields.filter((f) => CATEGORY_KINDS.includes(f.kind));
  const pick = (id) => { const f = choices.find((x) => x.id === id); return f ? { id: f.id, name: f.name, kind: f.kind } : null; };
  const id = (name) => `cs-wk-${index}-${name}`;

  return <Card title={report.name || 'New weekly report'} actions={<Button small appearance="subtle" onClick={onRemove}>Remove</Button>}>
    <div className="nq-stack">
      <Field label="Name" htmlFor={id('name')} help="Shown to agents and, when published, to customers. For example “Ryanair weekly SD report”.">
        <input id={id('name')} className="nq-input" maxLength={60} value={report.name} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <Field label={`Organisations (${listed.length} of ${MAX_WEEKLY_ORGS})`} htmlFor={id('orgs')} help="Key metrics are shown for all of them together and, with more than one, for each (for example Ryanair Crew on its own).">
        <input id={id('orgs')} className="nq-input" placeholder="Search organisations" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="cs-orgs">{shown.map((o) => {
          const on = listed.some((w) => w.id === o.id);
          return <label className="cs-check" key={o.id}>
            <input type="checkbox" className="nq-check" checked={on} disabled={!on && listed.length >= MAX_WEEKLY_ORGS}
              onChange={(e) => set({ organizations: e.target.checked ? [...listed, { id: o.id, name: o.name }] : listed.filter((w) => w.id !== o.id) })} />
            <span>{o.name}</span>
          </label>;
        })}</div>
      </Field>
      <Field label="Projects (optional)" htmlFor={id('projects')} help="Project keys, for example SD. Leave empty for every project the organisations’ tickets are in.">
        <input id={id('projects')} className="nq-input" placeholder="e.g. SD" value={Array.isArray(report.projects) ? report.projects.join(', ') : report.projects || ''}
          onChange={(e) => set({ projects: e.target.value.toUpperCase() })} />
      </Field>
      <div className="cs-row cs-row--pair">
        <Field label="Category field" htmlFor={id('category')} help="Top issues are tickets by this field. A cascading field gives the subcategory too.">
          <select id={id('category')} className="nq-select" value={report.categoryField?.id || ''} onChange={(e) => set({ categoryField: pick(e.target.value) })}>
            <option value="">None</option>
            {choices.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </Field>
        <Field label="Subcategory field (optional)" htmlFor={id('subcategory')} help="The biggest category is split by this field.">
          <select id={id('subcategory')} className="nq-select" value={report.subcategoryField?.id || ''} onChange={(e) => set({ subcategoryField: pick(e.target.value) })}>
            <option value="">{report.categoryField?.kind === 'cascading' ? 'Second level of the category' : 'None'}</option>
            {choices.filter((f) => f.id !== report.categoryField?.id).map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </Field>
      </div>
      <label className="cs-check">
        <input type="checkbox" className="nq-check" checked={report.aiNotes !== false} onChange={(e) => set({ aiNotes: e.target.checked })} />
        <span>Write insights and suggest actions with AI when each week is built</span>
      </label>
      <p className="nq-muted">Uses Atlassian-hosted Claude with the week’s figures and a few ticket summaries per category; nothing leaves Atlassian. Last week’s open actions are always carried over. Agents review everything before publishing.</p>
      <label className="cs-check">
        <input type="checkbox" className="nq-check" checked={report.portal === true} onChange={(e) => set({ portal: e.target.checked })} />
        <span>Show published weeks on the customer portal (“Weekly SD report”)</span>
      </label>
      <p className="nq-muted">Separate from service reports. Members of any of these organisations see every published week, with the agents’ notes, and can download it as Excel. Jira admins and project admins publish each week.</p>
    </div>
  </Card>;
}

export default function WeeklySettings({ value, organizations = [], fields = [], onChange }) {
  const reports = value?.reports || [];
  const setReport = (i, report) => onChange({ reports: reports.map((r, n) => (n === i ? report : r)) });
  return <>
    <Card title="Weekly report" description="A report for last week, built early every Monday (weeks run Monday to Sunday, Irish time): open tickets, created and resolved, % resolved, top issues by category, the workload to resolve them, and the account team’s insights, action register and progress. Agents find it on the Weekly report tab; the last 12 weeks are kept.">
      <div className="nq-spread">
        <span className="nq-muted">{reports.length} of {MAX_WEEKLY_REPORTS} reports. A report needs a name and at least one organisation to be saved.</span>
        <Button small disabled={reports.length >= MAX_WEEKLY_REPORTS}
          onClick={() => onChange({ reports: [...reports, { name: '', organizations: [], projects: [], categoryField: null, subcategoryField: null, portal: false, aiNotes: true }] })}>Add a weekly report</Button>
      </div>
    </Card>
    {reports.map((r, i) => <ReportEditor key={r.id || `new-${i}`} report={r} index={i} organizations={organizations} fields={fields}
      onChange={(report) => setReport(i, report)} onRemove={() => onChange({ reports: reports.filter((_, n) => n !== i) })} />)}
  </>;
}
