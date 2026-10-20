// Devices affected (settings → Customers → Devices): distinct devices behind
// each recurring issue, against the fleet worked out from crew numbers, with
// the priority the share suggests. With a roster share (crew flying on a typical
// day) the fleet is the devices in use that day and each issue is judged on its
// worst single day, as the Ryanair contract does. Agents decide the actual priority.
import React from 'react';
import { Card, Lozenge } from '@retailinmotion/ui/react';
import { deviceImpact, fleetForHeadcount, worstDay } from '../../../src/devices.js';

const n = (value) => Number(value || 0).toLocaleString();

export function PriorityLozenge({ suggested }) {
  if (!suggested) return null;
  return <Lozenge kind={suggested === 'P1' ? 'danger' : 'warning'}>Suggested {suggested}</Lozenge>;
}

export function impactLine(impact) {
  const count = (i) => (i.estimated && i.estimated !== i.devices ? `${n(i.devices)} reported (≈${n(i.estimated)} affected)` : n(i.devices));
  return impact.map((i) => (i.fleet ? `${count(i)} of ${n(i.fleet)} ${i.label} (${i.share}%)` : `${count(i)} ${i.label}`)).join(' · ');
}

export default function DevicesCard({ report, groups, nameOf, headcount }) {
  const config = report?.deviceConfig;
  if (!config || !report.devices?.any) return null;
  const { fleet, daily, crew, reportShare } = fleetForHeadcount(headcount, config);
  // Daily fleet: judge each issue on its worst single day; otherwise the whole period.
  const counts = (c) => (daily ? worstDay(c) : c);
  const overall = deviceImpact(counts(report.devices), fleet, config, { reportShare });
  const rows = (groups || [])
    .map((g, index) => ({ index, impact: deviceImpact(counts(g.devices), fleet, config, { reportShare }) }))
    .filter((r) => r.impact.length)
    .sort((a, b) => (b.impact[0].share ?? -1) - (a.impact[0].share ?? -1) || b.impact[0].devices - a.impact[0].devices)
    .slice(0, 10);
  return <Card title="Devices affected"
    description={`Distinct devices named on the tickets (by device ID), by device type.${daily ? ` Measured against devices in use on a typical day: ${n(crew)} crew (${headcount.flying.share}% of the crew list flying${(headcount.flying.usingShare ?? 100) < 100 ? ` × ${headcount.flying.usingShare}% using a device` : ''}${headcount.flying.days ? `, from a ${headcount.flying.days}-day roster` : ''}) × ${config.types.map((t) => `${t.perCrew} ${t.label}`).join(' and ')} each, using each issue’s worst single day.${reportShare < 100 ? ` Only ${reportShare}% of affected crew raise a ticket (one per crew team), so reported devices are scaled up to an estimate of devices affected.` : ''}` : crew ? ` Fleet from crew numbers: ${config.types.map((t) => `${t.perCrew} ${t.label}`).join(' and ')} per crew member. Upload a roster in settings (Crew numbers) to measure against crew flying that day.` : ' Add crew numbers for this organisation to see the share of the fleet.'} Suggested priority: P1 at ${config.p1Percent}%+, P2 at ${config.p2Percent}%+.${report.sampled ? ' Counted from the analysed sample, so the real number can be higher.' : ''}`}>
    <p><strong>{daily ? 'Worst day in the period:' : 'In the period:'}</strong> {impactLine(overall)}</p>
    <div className="nq-table-wrap">
      <table className="nq-table ci-devices">
        <thead><tr><th>Issue</th><th>Devices affected</th><th className="ci-num">Suggested</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.index}>
          <td>{nameOf(groups[r.index], r.index)}</td>
          <td>{impactLine(r.impact)}</td>
          <td className="ci-num">{r.impact[0].suggested ? <PriorityLozenge suggested={r.impact[0].suggested} /> : <span className="nq-muted">–</span>}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </Card>;
}
