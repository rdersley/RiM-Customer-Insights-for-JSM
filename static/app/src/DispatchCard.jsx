// Hardware dispatch (hardwareDispatch resolver, src/dispatch.js): time to send
// devices against the target, the queue still waiting, devices not yet
// returned, and whether the queue is growing, by device type.
import React from 'react';
import { Card, Kpi, Loading, Lozenge, Notice } from '@retailinmotion/ui/react';
import { hoursText } from '../../../src/dispatch.js';

const n = (value) => Number(value || 0).toLocaleString();

function Weekly({ weekly }) {
  const top = Math.max(1, ...weekly.flatMap((w) => [w.created, w.sent]));
  return <div className="ci-dispatch__weeks" role="img" aria-label="Requests and devices sent per week">
    {weekly.map((w) => <div className="ci-dispatch__week" key={w.from} title={`Week of ${w.from}: ${w.created} requests, ${w.sent} sent`}>
      <div className="ci-dispatch__bars">
        <i className="ci-dispatch__in" style={{ height: `${Math.max(2, (w.created / top) * 100)}%` }} />
        <i className="ci-dispatch__out" style={{ height: `${Math.max(2, (w.sent / top) * 100)}%` }} />
      </div>
      <span>{w.from.slice(5)}</span>
    </div>)}
  </div>;
}

export default function DispatchCard({ data, loading, error }) {
  if (loading) return <Card title="Hardware dispatch"><Loading inline text="Reading the dispatch queue and ticket histories…" /></Card>;
  if (error) return <Card title="Hardware dispatch"><Notice kind="error">{error}</Notice></Card>;
  // Not switched on for these projects: the resolver returns nothing, which can arrive as {}.
  if (!data?.trend) return null;
  const { queue, sent, trend, targetHours: target } = data;
  const growing = trend.net !== null && trend.net > 0;
  return <Card title="Hardware dispatch"
    description={`Time from the request to the device being sent (first move to a sent status), against the ${target}-hour target, and the queue still waiting now. Sent figures are for the period; the queue and returns are as of now.`}>
    {!data.complete && <Notice>Some tickets took too long to read, so figures are partial. Try a shorter period or narrow by client.</Notice>}
    <div className="nq-kpis">
      <Kpi icon="✓" kind={sent.withinShare >= 90 ? 'success' : sent.withinShare >= 50 ? 'warning' : 'danger'} label={`Sent within ${target} h`} value={sent.withinShare === null ? '–' : `${sent.withinShare}%`} hint={`${n(sent.withinTarget)} of ${n(sent.sent)} sent in the period`} />
      <Kpi icon="⏱" kind="info" label="Typical time to send" value={hoursText(sent.medianHours)} hint={`90% within ${hoursText(sent.p90Hours)}`} />
      <Kpi icon="▤" kind={queue.overTarget ? 'danger' : 'success'} label="Waiting to be sent" value={n(queue.total)} hint={`${n(queue.overTarget)} over ${target} h · oldest ${queue.oldestDays} days`} />
      <Kpi icon={growing ? '↗' : '↘'} kind={growing ? 'danger' : 'success'} label="Queue per week" value={trend.net === null ? '–' : `${trend.net > 0 ? '+' : ''}${trend.net}`}
        hint={trend.net === null ? '' : growing ? `${trend.createdPerWeek} requests vs ${trend.sentPerWeek} sent a week` : trend.clearWeeks ? `clears in about ${trend.clearWeeks} weeks` : 'level'} />
      {data.returns > 0 && <Kpi icon="↩" kind="warning" label="Sent, not yet returned" value={n(data.returns)} hint="old devices still out" />}
    </div>
    <div className="ci-dispatch__ages">{queue.bands.map((b) => <span key={b.label}><strong>{n(b.count)}</strong> {b.label.toLowerCase()}</span>)}</div>
    <div className="nq-table-wrap">
      <table className="nq-table ci-dispatch">
        <thead><tr><th>Device</th><th className="ci-num">Waiting</th><th className="ci-num">Over {target} h</th><th className="ci-num">Oldest</th><th className="ci-num">Sent</th><th className="ci-num">Typical time</th><th className="ci-num">90% within</th><th className="ci-num">Within {target} h</th><th className="ci-num">Not returned</th></tr></thead>
        <tbody>{data.byDevice.map((d) => <tr key={d.device}>
          <td>{d.device}</td>
          <td className="ci-num">{n(d.queue)}</td>
          <td className="ci-num">{d.overTarget ? <Lozenge kind="danger">{n(d.overTarget)}</Lozenge> : '0'}</td>
          <td className="ci-num">{d.queue ? `${d.oldestDays} d` : '–'}</td>
          <td className="ci-num">{n(d.sent)}</td>
          <td className="ci-num">{hoursText(d.medianHours)}</td>
          <td className="ci-num">{hoursText(d.p90Hours)}</td>
          <td className="ci-num">{d.withinShare === null ? '–' : `${d.withinShare}%`}</td>
          <td className="ci-num">{d.returns ? n(d.returns) : '–'}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {data.weekly?.length > 0 && <>
      <p className="nq-muted"><span className="ci-dispatch__key ci-dispatch__in" /> requests <span className="ci-dispatch__key ci-dispatch__out" /> devices sent, per week (last {data.weekly.length} full weeks)</p>
      <Weekly weekly={data.weekly} />
    </>}
  </Card>;
}
