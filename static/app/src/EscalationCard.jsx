// Escalation levels (escalation resolver): what level tickets created in the
// period reached, and how long they took to reach 2nd and 3rd level.
import React from 'react';
import { Card, Kpi, Loading, Notice } from '@retailinmotion/ui/react';
import { duration } from '../../../src/trend.js';

const n = (value) => Number(value || 0).toLocaleString();
const LEVEL = ['No level status', '1st level', '2nd level', '3rd level'];
const time = (h) => (h === null || h === undefined ? '–' : duration(h));

export default function EscalationCard({ data, loading, error }) {
  if (loading) return <Card title="Escalation levels"><Loading inline text="Reading ticket histories for escalation…" /></Card>;
  if (error) return <Card title="Escalation levels"><Notice kind="error">{error}</Notice></Card>;
  if (!data) return null;
  const reach = (level) => data.reach.find((r) => r.level === level);
  const highest = (level) => data.byLevel.find((l) => l.level === level);
  const approx = data.sampled ? '≈' : '';
  return <Card title="Escalation levels"
    description={`Tickets created in the period: the highest support level each reached, and how long after creation it got there.${data.sampled ? ' Shares and times come from an even sample of the period.' : ''}`}>
    <div className="nq-kpis">
      <Kpi icon="①" kind="success" label="Stayed at 1st level" value={`${highest(1)?.share ?? 0}%`} hint={`${approx}${n(highest(1)?.tickets)} tickets`} />
      <Kpi icon="②" kind="warning" label="Went to 2nd level" value={`${reach(2)?.share ?? 0}%`} hint={`${approx}${n(reach(2)?.tickets)} tickets`} />
      <Kpi icon="⏱" kind="info" label="Time to 2nd level" value={time(reach(2)?.medianHours)} hint={`typical · average ${time(reach(2)?.averageHours)} · 90% within ${time(reach(2)?.p90Hours)}`} />
      {reach(3)?.tickets > 0 && <Kpi icon="③" kind="danger" label="Went to 3rd level" value={`${reach(3).share}%`} hint={`typical ${time(reach(3).medianHours)} to get there`} />}
    </div>
    <div className="nq-table-wrap">
      <table className="nq-table ci-escalation">
        <thead><tr><th>Highest level reached</th><th className="ci-num">Tickets</th><th className="ci-num">Share</th><th className="ci-num">Typical time to reach</th><th className="ci-num">Average</th><th className="ci-num">90% within</th></tr></thead>
        <tbody>{[1, 2, 3, 0].map((level) => {
          const h = highest(level);
          const r = reach(level);
          if (!h?.tickets && level !== 1) return null;
          return <tr key={level}>
            <td>{LEVEL[level]}</td>
            <td className="ci-num">{approx}{n(h?.tickets)}</td>
            <td className="ci-num">{h?.share ?? 0}%</td>
            <td className="ci-num">{level >= 2 ? time(r?.medianHours) : '–'}</td>
            <td className="ci-num">{level >= 2 ? time(r?.averageHours) : '–'}</td>
            <td className="ci-num">{level >= 2 ? time(r?.p90Hours) : '–'}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
    {!data.complete && <Notice>Not every ticket’s history could be read in time; figures cover the tickets that were.</Notice>}
    <p className="nq-muted">Levels come from statuses: {data.mapping.map((m) => `${LEVEL[m.level]}: ${m.statuses.join(', ') || 'none seen'}`).join(' · ')}. Times to reach a level count every ticket that got there, including ones that went further. Set the statuses in Customer Insights settings (Internal → {data.profile?.name || 'project settings'} → Escalation levels).</p>
  </Card>;
}
