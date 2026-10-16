// Settings → Customers → Email reports: the Microsoft 365 connection, schedules
// (weekly, monthly or send-only) and the send log. Saved straight away; the
// client secret is write-only.
import React, { useEffect, useState } from 'react';
import { Button, Card, Field, Loading, Lozenge, Notice } from '@retailinmotion/ui/react';
import { PRESETS } from '../../../src/dates.js';
import { EMAIL_PERIODS } from '../../../src/email.js';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const ZONE = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();
const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const periodLabel = (key) => PRESETS.find((p) => p.key === key)?.label || key;
const blank = () => ({ name: '', enabled: true, organizations: [], period: 'last-week', frequency: 'weekly', weekday: 1, dayOfMonth: 1, hour: 8, timeZone: ZONE, internal: '', customers: '', ai: false, subject: '', message: '' });
const describe = (s) => (s.frequency === 'manual' ? 'Send now only'
  : s.frequency === 'weekly' ? `Every ${DAYS[s.weekday - 1]} at ${String(s.hour).padStart(2, '0')}:00`
    : `Monthly on day ${s.dayOfMonth} at ${String(s.hour).padStart(2, '0')}:00`) + ` (${s.timeZone}) · ${periodLabel(s.period)}`;

function ScheduleForm({ value, organizations, onSave, onCancel, saving }) {
  const [s, setS] = useState({ ...blank(), ...value, internal: (value.internal || []).join?.(', ') ?? value.internal ?? '', customers: (value.customers || []).join?.(', ') ?? value.customers ?? '' });
  const [filter, setFilter] = useState('');
  const set = (change) => setS((x) => ({ ...x, ...change }));
  const term = filter.trim().toLowerCase();
  const shown = [...s.organizations, ...organizations.filter((o) => !s.organizations.some((x) => x.id === o.id) && (!term || o.name.toLowerCase().includes(term))).slice(0, 40)];
  return <div className="nq-stack cs-email-form">
    <div className="cs-row cs-row--pair">
      <Field label="Name" htmlFor="cs-em-name"><input id="cs-em-name" className="nq-input" maxLength={80} value={s.name} onChange={(e) => set({ name: e.target.value })} placeholder="Ryanair weekly report" /></Field>
      <Field label="Report period" htmlFor="cs-em-period">
        <select id="cs-em-period" className="nq-select" value={s.period} onChange={(e) => set({ period: e.target.value })}>
          {EMAIL_PERIODS.map((p) => <option key={p} value={p}>{periodLabel(p)}</option>)}
        </select>
      </Field>
    </div>
    <Field label={`Organisations (${s.organizations.length} of 10)`} htmlFor="cs-em-orgs">
      <input id="cs-em-orgs" className="nq-input" placeholder="Search organisations" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="cs-orgs">{shown.map((o) => {
        const on = s.organizations.some((x) => x.id === o.id);
        return <label className="cs-check" key={o.id}>
          <input type="checkbox" className="nq-check" checked={on} disabled={!on && s.organizations.length >= 10}
            onChange={(e) => set({ organizations: e.target.checked ? [...s.organizations, { id: o.id, name: o.name }] : s.organizations.filter((x) => x.id !== o.id) })} />
          <span>{o.name}</span>
        </label>;
      })}</div>
    </Field>
    <div className="cs-row cs-email-when">
      <Field label="Send" htmlFor="cs-em-freq">
        <select id="cs-em-freq" className="nq-select" value={s.frequency} onChange={(e) => set({ frequency: e.target.value, period: e.target.value === 'monthly' ? 'last-month' : s.period })}>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
          <option value="manual">Only when I click Send now</option>
        </select>
      </Field>
      {s.frequency === 'weekly' && <Field label="On" htmlFor="cs-em-day">
        <select id="cs-em-day" className="nq-select" value={s.weekday} onChange={(e) => set({ weekday: Number(e.target.value) })}>
          {DAYS.map((d, i) => <option key={d} value={i + 1}>{d}</option>)}
        </select>
      </Field>}
      {s.frequency === 'monthly' && <Field label="Day of month" htmlFor="cs-em-dom">
        <input id="cs-em-dom" className="nq-input cs-number" type="number" min={1} max={28} value={s.dayOfMonth} onChange={(e) => set({ dayOfMonth: Number(e.target.value) })} />
      </Field>}
      {s.frequency !== 'manual' && <Field label="At" htmlFor="cs-em-hour">
        <select id="cs-em-hour" className="nq-select" value={s.hour} onChange={(e) => set({ hour: Number(e.target.value) })}>
          {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
        </select>
      </Field>}
      {s.frequency !== 'manual' && <Field label="Time zone" htmlFor="cs-em-tz"><input id="cs-em-tz" className="nq-input" value={s.timeZone} onChange={(e) => set({ timeZone: e.target.value })} /></Field>}
    </div>
    <div className="cs-row cs-row--pair">
      <Field label="Internal recipients" htmlFor="cs-em-int" help="Staff, separated by commas. Copied in when there are customer recipients.">
        <textarea id="cs-em-int" className="nq-textarea" rows={2} value={s.internal} onChange={(e) => set({ internal: e.target.value })} placeholder="name@retailinmotion.com" />
      </Field>
      <Field label="Customer recipients" htmlFor="cs-em-cust" help="The customer's contacts, separated by commas. Leave empty for an internal-only report: those also include the customer health score.">
        <textarea id="cs-em-cust" className="nq-textarea" rows={2} value={s.customers} onChange={(e) => set({ customers: e.target.value })} />
      </Field>
    </div>
    <div className="cs-row cs-row--pair">
      <Field label="Subject" htmlFor="cs-em-subject" help="{organisation} and {period} are filled in.">
        <input id="cs-em-subject" className="nq-input" maxLength={150} value={s.subject} onChange={(e) => set({ subject: e.target.value })} placeholder="{organisation} service report: {period}" />
      </Field>
      <Field label="Message" htmlFor="cs-em-msg" help="Leave empty for a short standard note.">
        <textarea id="cs-em-msg" className="nq-textarea" rows={2} value={s.message} onChange={(e) => set({ message: e.target.value })} />
      </Field>
    </div>
    <label className="cs-check"><input type="checkbox" className="nq-check" checked={s.ai} onChange={(e) => set({ ai: e.target.checked })} /><span>Include the AI summary (Atlassian-hosted AI; check the first few reports before sending to customers)</span></label>
    <label className="cs-check"><input type="checkbox" className="nq-check" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} /><span>Schedule on</span></label>
    <div className="nq-inline">
      <Button appearance="primary" small disabled={saving} onClick={() => onSave(s)}>{saving ? 'Saving…' : 'Save schedule'}</Button>
      <Button appearance="subtle" small onClick={onCancel}>Cancel</Button>
    </div>
  </div>;
}

export default function EmailReports({ invoke, organizations = [] }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [config, setConfig] = useState({ tenantId: '', clientId: '', sender: '' });
  const [secret, setSecret] = useState('');
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState('');
  const [testTo, setTestTo] = useState('');

  const load = () => invoke('getEmailSettings').then((d) => { setData(d); setConfig({ tenantId: '', clientId: '', sender: '', ...d.config }); }).catch((e) => setError(e.message || 'Email settings could not be loaded.'));
  useEffect(() => { load(); }, [invoke]);
  const run = async (key, fn, done) => {
    setBusy(key); setError(''); setNote('');
    try { await fn(); if (done) setNote(done); await load(); } catch (e) { setError(e.message || 'That didn’t work.'); } finally { setBusy(''); }
  };
  const ready = data?.config?.tenantId && data?.config?.clientId && data?.config?.sender && data?.secretSet;

  return <Card title="Email reports" description="Email the report PDF to staff and customers on a schedule, from a Microsoft 365 mailbox. Each email runs the analysis for the period and attaches the same PDF as Export PDF.">
    {error && <Notice kind="error">{error}</Notice>}
    {note && <Notice kind="success">{note}</Notice>}
    {!data && !error && <Loading inline text="Loading email settings…" />}
    {data && <div className="nq-stack">
      <details className="cs-email-conn" open={!ready}>
        <summary><strong>Microsoft 365 connection</strong> {ready ? <Lozenge kind="success">Set up</Lozenge> : <Lozenge kind="warning">Not set up</Lozenge>}</summary>
        <p className="nq-muted">An Azure app registration with the Mail.Send application permission (admin consent). Ask IT to limit it to the sender mailbox with an application access policy.</p>
        <div className="cs-row cs-row--pair">
          <Field label="Tenant ID" htmlFor="cs-em-tenant"><input id="cs-em-tenant" className="nq-input" value={config.tenantId} onChange={(e) => setConfig({ ...config, tenantId: e.target.value })} /></Field>
          <Field label="Application (client) ID" htmlFor="cs-em-client"><input id="cs-em-client" className="nq-input" value={config.clientId} onChange={(e) => setConfig({ ...config, clientId: e.target.value })} /></Field>
          <Field label="Client secret" htmlFor="cs-em-secret" help={data.secretSet ? 'A secret is saved. Enter a new one only to replace it.' : 'Stored encrypted; never shown again.'}>
            <input id="cs-em-secret" className="nq-input" type="password" autoComplete="new-password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={data.secretSet ? '••••••••' : ''} />
          </Field>
          <Field label="Send from (mailbox)" htmlFor="cs-em-sender"><input id="cs-em-sender" className="nq-input" value={config.sender} onChange={(e) => setConfig({ ...config, sender: e.target.value })} placeholder="reports@retailinmotion.com" /></Field>
        </div>
        <Button small disabled={Boolean(busy)} onClick={() => run('conn', async () => { await invoke('saveEmailConfig', { config, secret }); setSecret(''); }, 'Connection saved.')}>Save connection</Button>
      </details>

      <div>
        <strong>Schedules</strong>
        {!data.schedules.length && <p className="nq-muted">No schedules yet.</p>}
        <ul className="cs-email-list">{data.schedules.map((s) => <li key={s.id}>
          <div>
            <strong>{s.name}</strong> {!s.enabled && <Lozenge>Off</Lozenge>}
            <p className="nq-muted">{s.organizations.map((o) => o.name).join(', ')} · {describe(s)} · {s.internal.length + s.customers.length} recipients{s.ai ? ' · AI summary' : ''}</p>
            <p className="nq-muted">{s.state?.lastError ? <><Lozenge kind="danger">Failed</Lozenge> {s.state.lastError}</> : s.state?.lastSentAt ? `Last sent ${when(s.state.lastSentAt)}` : 'Not sent yet'}{s.state?.queuedAt && !s.state?.lastSentAt ? ' · queued' : ''}</p>
          </div>
          <div className="nq-inline cs-email-actions">
            <Button small disabled={!ready || Boolean(busy)} onClick={() => run(s.id, () => invoke('sendScheduleNow', { id: s.id }), `Sending “${s.name}” now. It usually takes a minute or two; refresh to see it in the log.`)}>Send now</Button>
            <Button small appearance="subtle" onClick={() => setEditing(s)}>Edit</Button>
            <Button small appearance="subtle" disabled={Boolean(busy)} onClick={() => run(s.id, () => invoke('deleteSchedule', { id: s.id }))}>Delete</Button>
          </div>
        </li>)}</ul>
        {data.schedules.length > 0 && <div className="cs-row cs-row--pair cs-email-test">
          <Field label="Send a test to" htmlFor="cs-em-test" help="Sends the first schedule's report to this address only.">
            <input id="cs-em-test" className="nq-input" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@retailinmotion.com" />
          </Field>
          <div><Button small disabled={!ready || !testTo || Boolean(busy)} onClick={() => run('test', () => invoke('sendScheduleNow', { id: data.schedules[0].id, testTo }), `Test queued to ${testTo}.`)}>Send test</Button></div>
        </div>}
        {editing
          ? <ScheduleForm value={editing} organizations={organizations} saving={busy === 'save'} onCancel={() => setEditing(null)}
            onSave={(s) => run('save', async () => { await invoke('saveSchedule', { schedule: s }); setEditing(null); }, 'Schedule saved.')} />
          : <Button small onClick={() => setEditing(blank())}>Add a schedule</Button>}
      </div>

      {data.log.length > 0 && <details>
        <summary>Recent sends ({data.log.length})</summary>
        <ul className="cs-email-log">{data.log.slice(0, 15).map((l, i) => <li key={i}>
          {when(l.at)} · {l.name} · {l.reason}{l.ok ? ` · sent to ${l.recipients} · ${l.period}` : ''} {l.ok ? <Lozenge kind="success">Sent</Lozenge> : <><Lozenge kind="danger">Failed</Lozenge> <span className="nq-muted">{l.error}</span></>}
        </li>)}</ul>
      </details>}
    </div>}
  </Card>;
}
