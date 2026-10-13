// Devices affected (settings → Customers → Devices): distinct devices behind
// each recurring issue, against the fleet worked out from crew numbers, with
// the priority the share suggests. Agents decide the actual priority.
import React from 'react';
import { Card, Lozenge } from '@retailinmotion/ui/react';
import { deviceImpact, fleetFromCrew } from '../../../src/devices.js';

const n = (value) => Number(value || 0).toLocaleString();

export function PriorityLozenge({ suggested }) {
  if (!suggested) return null;
  return <Lozenge kind={suggested === 'P1' ? 'danger' : 'warning'}>Suggested {suggested}</Lozenge>;
}

export function impactLine(impact) {
  return impact.map((i) => (i.fleet ? `${n(i.devices)} of ${n(i.fleet)} ${i.label} (${i.share}%)` : `${n(i.devices)} ${i.label}`)).join(' · ');
}

export default function DevicesCard({ report, groups, nameOf, headcount }) {
  const config = report?.deviceConfig;
  if (!config || !report.devices?.any) return null;
  const crew = headcount ? headcount.values.reduce((t, v) => t + v.count, 0) : 0;
  const fleet = fleetFromCrew(crew, config);
  const overall = deviceImpact(report.devices, fleet, config);
  const rows = (groups || [])
    .map((g, index) => ({ index, impact: deviceImpact(g.devices, fleet, config) }))
    .filter((r) => r.impact.length)
    .sort((a, b) => (b.impact[0].share ?? -1) - (a.impact[0].share ?? -1) || b.impact[0].devices - a.impact[0].devices)
    .slice(0, 10);
  return <Card title="Devices affected"
    description={`Distinct devices named on the tickets (by device ID), by device type.${crew ? ` Fleet from crew numbers: ${config.types.map((t) => `${t.perCrew} ${t.label}`).join(' and ')} per crew member.` : ' Add crew numbers for this organisation to see the share of the fleet.'} Suggested priority: P1 at ${config.p1Percent}%+ of a fleet, P2 at ${config.p2Percent}%+.${report.sampled ? ' Counted from the analysed sample, so the real number can be higher.' : ''}`}>
    <p><strong>In the period:</strong> {impactLine(overall)}</p>
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
