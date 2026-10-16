// Customer health (src/health.js): the score for the report on screen, and the
// all-customers list worked out once a day (healthJobs.js). Internal only.
import React, { useState } from 'react';
import { Button, Card, EmptyState, Lozenge } from '@retailinmotion/ui/react';
import { AGED_DAYS, bandOf, HEALTH_SIGNALS } from '../../../src/health.js';

const signalKind = (score) => bandOf(score)?.kind || 'neutral';

function Meter({ score }) {
  return <span className={`ci-health__meter ci-health__meter--${signalKind(score)}`}><i style={{ width: `${Math.max(2, score)}%` }} /></span>;
}

function Score({ score, band, kind }) {
  return <div className={`ci-health__score ci-health__score--${kind || 'neutral'}`}>
    <strong>{score}</strong>
    <span>{band}</span>
  </div>;
}

function Sparkline({ history }) {
  const points = (history || []).filter((p) => p.score !== null);
  if (points.length < 2) return null;
  const w = 80;
  const h = 22;
  const step = w / (points.length - 1);
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${(h - 1 - (p.score / 100) * (h - 2)).toFixed(1)}`).join(' ');
  return <svg className="ci-spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true"><path d={d} /></svg>;
}

/** The health score for the report on screen. `health` is healthOf(report, backlog). */
export function HealthCard({ health, backlogLoading, includeInPdf, onIncludeInPdf }) {
  if (!health) return null;
  if (health.score === null) {
    return <Card title="Customer health" description="Internal: not shown on the portal or sent to customers.">
      <EmptyState compact title={backlogLoading ? 'Working out the score…' : 'Not enough data in this period for a health score.'} />
    </Card>;
  }
  return <Card title="Customer health" description={`Internal: not shown on the portal or sent to customers. 0–100, higher is healthier, from this period's tickets and the open backlog now (aged = over ${AGED_DAYS} days).`}
    actions={<label className="ci-health__pdf">
      <input type="checkbox" className="nq-check" checked={includeInPdf} onChange={(e) => onIncludeInPdf(e.target.checked)} />
      <span>Include in PDF</span>
    </label>}>
    <div className="ci-health">
      <Score score={health.score} band={health.band.label} kind={health.band.kind} />
      <table className="nq-table ci-health__signals">
        <thead><tr><th>Signal</th><th /><th className="ci-num">Score</th><th className="ci-num">Weight</th></tr></thead>
        <tbody>{health.signals.map((s) => <tr key={s.key}>
          <td><strong>{s.label}</strong>{health.weakest === s.key && <> <Lozenge kind="warning">Weakest</Lozenge></>}</td>
          <td className="nq-muted">{s.detail}</td>
          <td className="ci-num"><span className="ci-health__cell"><Meter score={s.score} /><strong>{s.score}</strong></span></td>
          <td className="ci-num nq-muted">{s.share}%</td>
        </tr>)}</tbody>
      </table>
    </div>
    {health.signals.length < HEALTH_SIGNALS.length && <p className="nq-muted">Left out (not enough data or not set up): {HEALTH_SIGNALS.filter((x) => !health.signals.some((s) => s.key === x.key)).map((x) => x.label).join(', ')}.</p>}
  </Card>;
}

const SHOWN = 10;

/** The all-customers list, worst first. `onAnalyse(row)` runs a report for that organisation. */
export function HealthBoard({ board, onAnalyse, canAnalyse }) {
  const [all, setAll] = useState(false);
  if (!board?.enabled) return null;
  const rows = [...board.rows].sort((a, b) => (a.score ?? 101) - (b.score ?? 101) || a.organization.name.localeCompare(b.organization.name));
  const shown = all ? rows : rows.slice(0, SHOWN);
  const atRisk = rows.filter((r) => r.kind === 'danger').length;
  const watch = rows.filter((r) => r.kind === 'warning').length;
  const updated = rows.map((r) => r.updatedAt).filter(Boolean).sort().pop();
  return <Card title="Customer health" description={`Last 30 days, worked out once a day. ${atRisk} at risk, ${watch} to watch${updated ? ` · updated ${new Date(updated).toLocaleString()}` : ''}. Internal only.`}>
    {!rows.length
      ? <EmptyState compact title="No scores yet." description="A Jira admin chooses the organisations in Customer Insights settings (Customer health). Scores appear after the next daily run." />
      : <div className="nq-table-wrap"><table className="nq-table ci-health__board">
        <thead><tr><th>Organisation</th><th className="ci-num">Score</th><th className="ci-num">7 days</th><th>Trend</th><th>Weakest signal</th><th className="ci-num">Tickets</th><th /></tr></thead>
        <tbody>{shown.map((r) => {
          const weakest = r.signals.find((s) => s.key === r.weakest);
          return <tr key={r.organization.id}>
            <td><strong>{r.organization.name}</strong>{r.lastError && <> <Lozenge kind="warning">Not updated</Lozenge></>}</td>
            <td className="ci-num">{r.score === null ? <span className="nq-muted">{r.queuedAt ? 'Working…' : '–'}</span> : <span className="ci-health__cell"><Lozenge kind={r.kind}>{r.band}</Lozenge><strong>{r.score}</strong></span>}</td>
            <td className={`ci-num ${r.change > 0 ? 'ci-up' : r.change < 0 ? 'ci-down' : 'nq-muted'}`}>{r.change === null ? '–' : `${r.change > 0 ? '+' : ''}${r.change}`}</td>
            <td><Sparkline history={r.history} /></td>
            <td className="nq-muted">{weakest ? `${weakest.label}: ${weakest.detail}` : '–'}</td>
            <td className="ci-num">{r.tickets === null ? '–' : r.tickets.toLocaleString()}</td>
            <td><Button small onClick={() => onAnalyse(r)} disabled={!canAnalyse(r)}>Analyse</Button></td>
          </tr>;
        })}</tbody>
      </table></div>}
    {rows.length > SHOWN && <Button appearance="subtle" small onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${rows.length}`}</Button>}
    {board.hidden > 0 && <p className="nq-muted">{board.hidden} more on the list {board.hidden === 1 ? 'is an organisation' : 'are organisations'} you can’t see.</p>}
  </Card>;
}
