// Team performance (agentPerformance resolver): team totals and a per-agent
// table, for every agent. Figures are for tickets resolved in the
// period; open tickets are as of now. Read with the work mix: an agent on harder
// or more urgent tickets is slower for good reasons.
import React, { useState } from 'react';
import { Card, Kpi, Loading, Notice } from '@retailinmotion/ui/react';
import { duration } from '../../../src/trend.js';
import { minutesText } from '../../../src/agents.js';

const n = (value) => Number(value || 0).toLocaleString();
const COLUMNS = [
  { key: 'resolved', label: 'Resolved', value: (r) => r.resolved },
  { key: 'medianHours', label: 'Typical time to resolve', value: (r) => r.medianHours ?? Infinity, asc: true },
  { key: 'aht', label: 'AHT', value: (r) => r.ahtMinutes ?? Infinity, asc: true, title: 'Average handling time: time in progress per ticket worked on' },
  { key: 'handlingHours', label: 'Handling', value: (r) => r.handlingHours ?? 0, title: 'Total time tickets were in progress with this agent' },
  { key: 'sla', label: 'SLA met', value: (r, slaId) => r.sla?.[slaId]?.metShare ?? -1 },
  { key: 'rating', label: 'Satisfaction', value: (r) => r.rating ?? -1 },
  { key: 'loggedHours', label: 'Logged', value: (r) => r.loggedHours },
  { key: 'open', label: 'Open now', value: (r) => r.open },
];

export default function TeamPerformance({ data, loading, error }) {
  const [sort, setSort] = useState('resolved');
  const [slaId, setSlaId] = useState('');
  if (loading) return <Card title="Team performance"><Loading inline text="Working out resolved and open tickets per agent…" /></Card>;
  if (error) return <Card title="Team performance"><Notice kind="error">{error}</Notice></Card>;
  if (!data?.team) return null;
  const sla = data.slaFields.find((s) => s.id === slaId) || data.slaFields[0] || null;
  const t = data.team;
  const approx = data.estimated ? '≈' : '';
  const column = COLUMNS.find((c) => c.key === sort) || COLUMNS[0];
  const rows = (data.agents || []).slice().sort((a, b) => {
    const va = column.value(a, sla?.id); const vb = column.value(b, sla?.id);
    return column.asc ? va - vb : vb - va;
  });
  const metShare = (row) => (sla && row.sla?.[sla.id]?.metShare !== null && row.sla?.[sla.id] ? `${row.sla[sla.id].metShare}%` : '–');

  return <Card title="Team performance"
    description={`Tickets resolved in the period, by who they were assigned to, and open tickets now.${data.estimated ? ' Large numbers are estimated from an even sample.' : ''} Read figures with the work mix: urgent or harder tickets take longer.`}
    actions={data.slaFields.length > 1 && <select className="nq-select ci-crew__sort" aria-label="SLA" value={sla?.id} onChange={(e) => setSlaId(e.target.value)}>
      {data.slaFields.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>}>
    <div className="nq-kpis">
      <Kpi icon="✓" kind="success" label="Resolved" value={n(t.resolved)} hint={`by ${n(t.agents)} ${t.agents === 1 ? 'agent' : 'agents'}`} />
      <Kpi icon="◷" kind="info" label="Typical time to resolve" value={t.medianHours === null ? '–' : duration(t.medianHours)} hint={`${t.urgentShare}% urgent`} />
      {data.handling && <Kpi icon="⏱" kind="info" label="AHT" value={minutesText(t.ahtMinutes)} hint={`in progress per ticket · ${approx}${n(t.handlingHours)} h in all`} />}
      {sla && <Kpi icon="⚑" kind={(t.sla?.[sla.id]?.metShare ?? 100) < 80 ? 'warning' : 'success'} label={`${sla.name} met`} value={metShare(t)} />}
      {data.satisfaction && <Kpi icon="☺" kind="info" label="Satisfaction" value={t.rating === null ? '–' : `${t.rating} / 5`} hint={`${n(t.rated)} rated`} />}
      <Kpi icon="▤" label="Open now" value={n(t.open)} hint={t.oldestOpenDays !== null ? `oldest ${n(t.oldestOpenDays)} days` : undefined} />
    </div>
    {data.handling && data.handling.tickets > 0 && data.handling.handled / data.handling.tickets < 0.2 && <Notice kind="warning" title="Little or no handling time found">
      Only {n(data.handling.handled)} of {n(data.handling.tickets)} resolved tickets spent time in {data.handling.statuses ? data.handling.statuses.join(', ') : 'an in-progress status'}. Statuses these tickets passed through: {data.handling.statusesSeen.map((s) => `${s.name} (${n(s.tickets)})`).join(', ')}. Check the handling statuses in Customer Insights settings (Internal → Handling time) match these names.
    </Notice>}
    {data.handling && !data.handling.complete && <Notice>Not every ticket’s history could be read in time, so AHT covers the tickets that were. Try a shorter period.</Notice>}
    {data.cutShort && <Notice>Not every ticket could be read in time; figures cover the tickets that were. Try a shorter period.</Notice>}
    {data.agents ? <>
      <div className="nq-table-wrap">
        <table className="nq-table ci-agents">
          <thead><tr>
            <th>Agent</th>
            {COLUMNS.filter((c) => (c.key !== 'sla' || sla) && (c.key !== 'rating' || data.satisfaction) && (!['aht', 'handlingHours'].includes(c.key) || data.handling)).map((c) => <th key={c.key} className="ci-num">
              <button type="button" className={`ci-link${sort === c.key ? ' is-sorted' : ''}`} onClick={() => setSort(c.key)} title={c.title || `Sort by ${c.label.toLowerCase()}`}>{c.key === 'sla' ? `${sla.name} met` : c.label}</button>
            </th>)}
            <th>Work mix</th>
          </tr></thead>
          <tbody>{rows.map((r) => <tr key={r.agent.id}>
            <td>{r.agent.name}</td>
            <td className="ci-num">{approx}{n(r.resolved)}</td>
            <td className="ci-num">{r.medianHours === null ? '–' : duration(r.medianHours)}</td>
            {data.handling && <td className="ci-num">{minutesText(r.ahtMinutes)}{r.handled ? <small className="nq-muted"> · {n(r.handled)}</small> : null}</td>}
            {data.handling && <td className="ci-num">{r.handlingHours ? `${approx}${n(r.handlingHours)} h` : '–'}</td>}
            {sla && <td className="ci-num">{metShare(r)}</td>}
            {data.satisfaction && <td className="ci-num">{r.rating === null ? '–' : `${r.rating} (${r.rated})`}</td>}
            <td className="ci-num">{r.loggedHours ? `${approx}${n(r.loggedHours)} h` : '–'}</td>
            <td className="ci-num">{n(r.open)}{r.oldestOpenDays ? <small className="nq-muted"> · {r.oldestOpenDays}d</small> : null}</td>
            <td className="nq-muted">{r.topTypes.map((x) => `${x.name} ${x.share}%`).join(', ') || '–'}{r.urgentShare ? ` · ${r.urgentShare}% urgent` : ''}</td>
          </tr>)}</tbody>
        </table>
      </div>
      <p className="nq-muted">Satisfaction shows the average rating and how many tickets were rated. AHT is the time a ticket spent in progress while assigned to the agent, per ticket they worked on (the small number); {data.handling?.statuses ? `in progress means: ${data.handling.statuses.join(', ')}` : 'waiting statuses such as “Waiting for customer” don’t count'}.</p>
    </> : null}
  </Card>;
}
