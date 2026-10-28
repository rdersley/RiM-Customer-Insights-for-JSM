// "Weekly report" tab: a Weekly SD report (settings → Weekly report) for one of
// the last 12 weeks. Weeks are built by a background job on Monday; agents can
// rebuild a week, write the insights, action register and progress, download
// it as Excel, and (Jira admins and project admins) publish it to the portal.
import React, { useEffect, useState } from 'react';
import { invoke } from '@forge/bridge';
import { Button, Card, EmptyState, Field, Loading, Lozenge, Notice } from '@retailinmotion/ui/react';
import { ACTION_STATUSES, EMPTY_NOTES, NOTE_LIMITS, weekLabel, weekOf } from '../../../src/weekly.js';
import WeeklyReportView from './WeeklyReportView.jsx';
import { downloadWeeklyExcel } from './exportExcel.js';

const when = (iso) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const addWeeks = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 7 * 86400000).toISOString().slice(0, 10);

function NotesEditor({ notes, onChange }) {
  const set = (change) => onChange({ ...notes, ...change });
  const setAction = (i, change) => set({ actions: notes.actions.map((a, n) => (n === i ? { ...a, ...change } : a)) });
  const text = (key, label, help) => <Field label={label} htmlFor={`wk-${key}`} help={help}>
    <textarea id={`wk-${key}`} className="nq-textarea" maxLength={NOTE_LIMITS.text} value={notes[key]} onChange={(e) => set({ [key]: e.target.value })} />
  </Field>;
  return <div className="wk-notes">
    {text('insights', 'Insights', 'One point per line. Shown as bullets.')}
    <div className="wk-actions-edit">
      <strong>Action register</strong>
      {notes.actions.map((a, i) => <div className="wk-action-row" key={i}>
        <input className="nq-input" aria-label="Action" placeholder="Action" maxLength={NOTE_LIMITS.action} value={a.action} onChange={(e) => setAction(i, { action: e.target.value })} />
        <input className="nq-input" aria-label="Owner" placeholder="Owner" maxLength={NOTE_LIMITS.owner} value={a.owner} onChange={(e) => setAction(i, { owner: e.target.value })} />
        <input className="nq-input" aria-label="Due" placeholder="Due" maxLength={NOTE_LIMITS.due} value={a.due} onChange={(e) => setAction(i, { due: e.target.value })} />
        <select className="nq-select" aria-label="Status" value={a.status} onChange={(e) => setAction(i, { status: e.target.value })}>
          {ACTION_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <Button small appearance="subtle" onClick={() => set({ actions: notes.actions.filter((_, n) => n !== i) })}>Remove</Button>
      </div>)}
      <div><Button small disabled={notes.actions.length >= NOTE_LIMITS.actions} onClick={() => set({ actions: [...notes.actions, { action: '', owner: '', due: '', status: 'Open' }] })}>Add action</Button></div>
    </div>
    {text('completed', 'Completed this week')}
    {text('inProgress', 'In progress')}
    {text('nextSteps', 'Next steps')}
  </div>;
}

export default function WeeklyTab() {
  const [list, setList] = useState(null);
  const [error, setError] = useState('');
  const [reportId, setReportId] = useState('');
  const [from, setFrom] = useState('');
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState(null);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);

  const loadList = () => invoke('getWeeklyReports').then((result) => {
    setList(result);
    setReportId((id) => (result.reports.some((r) => r.id === id) ? id : result.reports[0]?.id || ''));
    setFrom((f) => f || result.latest);
    return result;
  }).catch((e) => setError(e.message || 'Weekly reports couldn’t be loaded.'));

  useEffect(() => { loadList(); }, []);

  const loadWeek = () => {
    if (!reportId || !from) return;
    setLoading(true); setMessage(null);
    invoke('getWeeklyReport', { id: reportId, from })
      .then((r) => { setRecord(r); setNotes(r?.notes ? { ...EMPTY_NOTES, ...r.notes } : null); })
      .catch((e) => { setRecord(null); setMessage({ kind: 'error', text: e.message }); })
      .finally(() => setLoading(false));
  };
  useEffect(loadWeek, [reportId, from]);

  if (error) return <Notice kind="error">{error}</Notice>;
  if (!list) return <Loading inline text="Loading weekly reports…" />;
  if (!list.reports.length) {
    return <EmptyState title="No weekly reports yet.">A Jira admin sets them up in Customer Insights settings → Weekly report: which organisations, and the category fields to break tickets down by.</EmptyState>;
  }

  const config = list.reports.find((r) => r.id === reportId);
  const weeks = Array.from({ length: 12 }, (_, i) => addWeeks(list.latest, -i));
  const dirty = record?.builtAt && notes && JSON.stringify(notes) !== JSON.stringify({ ...EMPTY_NOTES, ...record.notes });
  const pending = Boolean(record?.queuedAt);

  async function run(label, fn) {
    setBusy(label); setMessage(null);
    try { await fn(); } catch (e) { setMessage({ kind: 'error', text: e.message || 'That didn’t work.' }); } finally { setBusy(''); }
  }
  const rebuild = () => run('rebuild', async () => {
    await invoke('rebuildWeekly', { id: reportId, from });
    await loadList(); loadWeek();
    setMessage({ kind: 'info', text: 'Building the week now. It takes a few minutes; use Check again to see it.' });
  });
  const saveNotes = () => run('notes', async () => {
    const saved = await invoke('saveWeeklyNotes', { id: reportId, from, notes });
    setRecord((r) => ({ ...r, notes: saved })); setNotes({ ...EMPTY_NOTES, ...saved });
    setMessage({ kind: 'success', text: record.publishedAt ? 'Notes saved. Customers see them on the portal now.' : 'Notes saved.' });
  });
  const publish = (on) => run('publish', async () => {
    const result = await invoke('publishWeekly', { id: reportId, from, publish: on });
    setRecord((r) => ({ ...r, publishedAt: result.publishedAt })); await loadList();
    setMessage({ kind: 'success', text: on ? 'Published. Customers in these organisations see it under “Weekly SD report” in the portal.' : 'Removed from the portal.' });
  });

  return <div className="wk-report">
    <div className="wk-pickers">
      <Field label="Report" htmlFor="wk-report">
        <select id="wk-report" className="nq-select" value={reportId} onChange={(e) => setReportId(e.target.value)}>
          {list.reports.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </Field>
      <Field label="Week (Monday to Sunday, Irish time)" htmlFor="wk-week">
        <select id="wk-week" className="nq-select" value={from} onChange={(e) => setFrom(e.target.value)}>
          {weeks.map((w) => {
            const s = config?.weeks.find((x) => x.from === w);
            return <option key={w} value={w}>{weekLabel(weekOf(w))}{s?.publishedAt ? ' · on portal' : s?.builtAt ? '' : ' · not built'}</option>;
          })}
        </select>
      </Field>
      <div className="nq-inline">
        {record?.builtAt && <Button onClick={() => downloadWeeklyExcel({ ...record, notes })}>Download Excel</Button>}
        <Button appearance="subtle" disabled={Boolean(busy) || pending} onClick={rebuild}>{record?.builtAt ? 'Rebuild' : 'Build now'}</Button>
        {pending && <Button appearance="subtle" onClick={() => { loadList(); loadWeek(); }}>Check again</Button>}
      </div>
    </div>

    {message && <Notice kind={message.kind}>{message.text}</Notice>}
    {loading && <Loading inline text="Loading the week…" />}
    {!loading && pending && <Notice>Being built since {when(record.queuedAt)}. This takes a few minutes.</Notice>}
    {!loading && record?.lastError && <Notice kind="error" title="The last build failed.">{record.lastError}</Notice>}
    {!loading && !record?.builtAt && !pending && <EmptyState compact title="This week hasn’t been built.">Weeks are built automatically early on Monday. Use Build now for an earlier week.</EmptyState>}

    {!loading && record?.builtAt && <>
      <p className="nq-muted">
        Built {when(record.builtAt)}{record.notesSavedAt ? ` · notes saved ${when(record.notesSavedAt)}` : ''} · {record.publishedAt ? <Lozenge kind="success">On the portal since {when(record.publishedAt)}</Lozenge> : <Lozenge>Not on the portal</Lozenge>}
      </p>
      <WeeklyReportView record={{ ...record, notes }} hideNotes />
      <Card title="Insights, actions and progress" description="Written by the account team for this week. Shown on the report, the portal and in Excel.">
        <NotesEditor notes={notes} onChange={setNotes} />
        <div className="nq-spread">
          <span className="nq-muted">{dirty ? 'Unsaved changes' : ''}</span>
          <div className="nq-inline">
            <Button appearance="subtle" disabled={!dirty || Boolean(busy)} onClick={() => setNotes({ ...EMPTY_NOTES, ...record.notes })}>Discard</Button>
            <Button appearance="primary" disabled={!dirty || Boolean(busy)} onClick={saveNotes}>{busy === 'notes' ? 'Saving…' : 'Save notes'}</Button>
          </div>
        </div>
      </Card>
      <Card title="Customer portal">
        {!config.portal ? <p className="nq-muted">This report isn’t set to show on the portal. A Jira admin can turn it on in Customer Insights settings → Weekly report.</p>
          : !list.canPublish ? <p className="nq-muted">Jira admins and project admins can publish this week to the portal.</p>
            : <div className="nq-spread">
              <span className="nq-muted">{record.publishedAt ? 'Customers in these organisations can see and download this week. Saved notes show straight away.' : 'Customers in these organisations will see this week, with your saved notes, and can download it as Excel.'}</span>
              {record.publishedAt
                ? <Button disabled={Boolean(busy)} onClick={() => publish(false)}>Remove from portal</Button>
                : <Button appearance="primary" disabled={Boolean(busy) || dirty} onClick={() => publish(true)}>{busy === 'publish' ? 'Publishing…' : 'Publish to portal'}</Button>}
            </div>}
        {dirty && config.portal && list.canPublish && !record.publishedAt && <p className="nq-muted">Save the notes first.</p>}
      </Card>
    </>}
  </div>;
}
