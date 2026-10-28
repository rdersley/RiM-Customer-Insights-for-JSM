// Settings → AI ticket summaries (src/ticketSummary.js). Off until an admin turns it on.
import React, { useEffect, useState } from 'react';
import { Button, Card, Field } from '@retailinmotion/ui/react';
import { BACKFILL_LIMITS, DEFAULT_TICKET_SUMMARY, MAX_SUMMARY_ORGS, QUIET_MINUTES } from '../../../src/ticketSummary.js';

const when = (iso) => (iso ? new Date(iso).toLocaleString() : '');

function Progress({ status }) {
  if (!status) return null;
  const { last, backfill, totalSummarised } = status;
  return <div className="nq-stack">
    {last && <p className="nq-muted">Last check {when(last.at)}: {last.summarised} summarised, {last.unchanged} unchanged{last.failed ? `, ${last.failed} failed` : ''}. {totalSummarised} summarised in total.</p>}
    {last?.failed > 0 && last.lastError && <p className="nq-muted">Last error: {last.lastError}</p>}
    {backfill && <p className="nq-muted">
      {backfill.running ? 'Summarising existing tickets' : 'Existing tickets'} (last {backfill.days} days): {backfill.checked} checked, {backfill.summarised} summarised{backfill.failed ? `, ${backfill.failed} failed` : ''}.
      {backfill.running ? ' Continues every 5 minutes.' : backfill.finishedAt ? ` Finished ${when(backfill.finishedAt)}.` : ''}
    </p>}
  </div>;
}

export default function TicketSummarySettings({ value, onChange, organizations = [], fields = [], invoke, saved }) {
  const config = { ...DEFAULT_TICKET_SUMMARY, ...value };
  const set = (change) => onChange({ ...config, ...change });
  const [filter, setFilter] = useState('');
  const [status, setStatus] = useState(null);
  const [note, setNote] = useState('');
  const term = filter.trim().toLowerCase();
  const watched = config.organizations;
  const shown = [...watched.filter((o) => !term || o.name.toLowerCase().includes(term)),
    ...organizations.filter((o) => !watched.some((w) => w.id === o.id) && (!term || o.name.toLowerCase().includes(term))).slice(0, 50)];
  const canRun = saved && config.enabled && watched.length > 0 && config.fieldId;

  useEffect(() => {
    if (!saved || !config.enabled) return undefined;
    let stop = false;
    const load = () => invoke('ticketSummaryStatus').then((s) => { if (!stop) setStatus(s); }).catch(() => {});
    load();
    const timer = setInterval(load, 30000);
    return () => { stop = true; clearInterval(timer); };
  }, [saved, config.enabled]);

  const run = async (name, pending) => {
    setNote(pending);
    try { setStatus(await invoke(name)); setNote(''); } catch (e) { setNote(e.message || 'That didn’t work.'); }
  };

  return <Card title="AI ticket summaries" description={`Write a short summary of each ticket's description and public comments into a field, so reports and Excel exports show what a ticket is about. Updated when a ticket has been quiet for ${QUIET_MINUTES} minutes after a change.`}>
    <div className="nq-stack">
      <label className="cs-check">
        <input type="checkbox" className="nq-check" checked={config.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        <span>Turn on AI ticket summaries</span>
      </label>
      {config.enabled && <>
        <Field label={`Organisations (up to ${MAX_SUMMARY_ORGS})`} htmlFor="cs-summary-filter" help="Only tickets shared with these organisations are summarised.">
          <input id="cs-summary-filter" className="nq-input" placeholder="Search organisations" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <div className="cs-orgs">{shown.map((o) => {
            const on = watched.some((w) => w.id === o.id);
            return <label className="cs-check" key={o.id}>
              <input type="checkbox" className="nq-check" checked={on} disabled={!on && watched.length >= MAX_SUMMARY_ORGS}
                onChange={(e) => set({ organizations: e.target.checked ? [...watched, { id: o.id, name: o.name }] : watched.filter((w) => w.id !== o.id) })} />
              <span>{o.name}</span>
            </label>;
          })}</div>
        </Field>
        <Field label="Summary field" htmlFor="cs-summary-field"
          help="A text custom field the app writes to, such as “Ticket overview”. A paragraph field holds the whole summary; a single-line one is cut at 255 characters. Add it to the request type if customers should see it in the portal.">
          <select id="cs-summary-field" className="nq-select" value={config.fieldId} onChange={(e) => set({ fieldId: e.target.value })}>
            <option value="">Choose a field</option>
            {fields.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.kind === 'textarea' ? 'paragraph' : 'single line'})</option>)}
          </select>
        </Field>
        <p className="nq-muted">Only the ticket's title, request type, status, description and the comments shared with the customer are sent, never internal comments. Summaries use Atlassian-hosted AI, so ticket text stays on the Atlassian platform. The app edits the field without notifying anyone.</p>
        <div className="cs-row cs-row--pair">
          <Field label="Summarise existing tickets from the last (days)" htmlFor="cs-summary-days" help={`Between ${BACKFILL_LIMITS.min} and ${BACKFILL_LIMITS.max}. Tickets already summarised and unchanged are skipped.`}>
            <input id="cs-summary-days" className="nq-input cs-number" type="number" min={BACKFILL_LIMITS.min} max={BACKFILL_LIMITS.max} step={1}
              value={config.backfillDays} onChange={(e) => set({ backfillDays: Number(e.target.value) })} />
          </Field>
        </div>
        <div className="nq-spread">
          <span className="nq-muted">{note || (saved ? '' : 'Save your changes first.')}</span>
          <span>
            {status?.backfill?.running
              ? <Button small onClick={() => run('stopTicketSummaryBackfill', 'Stopping…')}>Stop</Button>
              : <Button small disabled={!canRun} onClick={() => run('startTicketSummaryBackfill', 'Starting…')}>Summarise existing tickets</Button>}
          </span>
        </div>
        <Progress status={status} />
      </>}
    </div>
  </Card>;
}
