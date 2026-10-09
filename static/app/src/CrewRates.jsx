// "Tickets per 100 crew": the report's tickets against the crew numbers an
// admin uploaded (settings → Crew numbers), overall and for each base.
import React, { useState } from 'react';
import { Button, Card, Kpi, Lozenge } from '@retailinmotion/ui/react';

const n = (value) => Number(value || 0).toLocaleString();
const rateText = (rate) => (rate === null || rate === undefined ? '–' : rate.toLocaleString(undefined, { maximumFractionDigits: 1 }));
const SORTS = {
  rate: { label: 'Highest rate', by: (a, b) => b.rate - a.rate || b.tickets - a.tickets },
  tickets: { label: 'Most tickets', by: (a, b) => b.tickets - a.tickets },
  crew: { label: 'Most crew', by: (a, b) => b.crew - a.crew },
};
const SHOWN = 15;

function Ratio({ ratio }) {
  if (ratio === null || ratio === undefined) return null;
  const text = `${ratio.toLocaleString(undefined, { maximumFractionDigits: 1 })}×`;
  if (ratio >= 1.5) return <Lozenge kind="warning">{text}</Lozenge>;
  if (ratio <= 0.5) return <Lozenge kind="success">{text}</Lozenge>;
  return <Lozenge>{text}</Lozenge>;
}

// `noun` is "tickets" for agents and "requests" on the portal.
export default function CrewRates({ rates, approx = '', onDrill, noun = 'tickets', source = 'settings' }) {
  const Noun = noun[0].toUpperCase() + noun.slice(1);
  const [sort, setSort] = useState('rate');
  const [all, setAll] = useState(false);
  const bases = [...rates.bases].sort(SORTS[sort].by);
  const shown = all ? bases : bases.slice(0, SHOWN);
  const top = Math.max(0.1, ...rates.bases.map((b) => b.rate || 0));
  const updated = rates.updatedAt ? new Date(rates.updatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';
  const change = rates.rate !== null && rates.previousRate !== null ? Math.round((rates.rate - rates.previousRate) * 10) / 10 : null;

  return <Card title={`${Noun} per 100 crew`}
    description={`${Noun} in the period for every 100 crew, by ${rates.field}. Crew numbers from ${source}${updated ? `, updated ${updated}` : ''}.${rates.estimated ? ' Base counts are estimated from the sample.' : ''}`}
    actions={<select className="nq-select ci-crew__sort" aria-label="Sort bases" value={sort} onChange={(e) => setSort(e.target.value)}>
      {Object.entries(SORTS).map(([key, s]) => <option key={key} value={key}>{s.label}</option>)}
    </select>}>
    <div className="nq-kpis">
      <Kpi icon="☺" label="Crew" value={n(rates.crew)} hint={`at ${rates.bases.length} ${rates.bases.length === 1 ? 'base' : 'bases'}`} />
      {rates.rate !== null && <Kpi icon="▤" kind={change > 0 ? 'warning' : change < 0 ? 'success' : 'info'} label={`${Noun} per 100 crew`} value={rateText(rates.rate)}
        hint={rates.previousRate !== null ? `previous period ${rateText(rates.previousRate)}` : undefined} />}
      <Kpi icon="⌂" kind="info" label="Average across bases" value={rateText(rates.average)} hint={`${noun} with a ${rates.field}`} />
    </div>
    <div className="nq-table-wrap">
      <table className="nq-table ci-crew">
        <thead><tr><th>{rates.field}</th><th className="ci-num">Crew</th><th className="ci-num">{Noun}</th><th>Per 100 crew</th><th className="ci-num">Vs average</th><th className="ci-num">Previous</th></tr></thead>
        <tbody>{shown.map((b) => <tr key={b.value}>
          <td>{onDrill && b.tickets ? <button type="button" className="ci-link" onClick={() => onDrill(b.value)} title={`Analyse only ${b.value}`}>{b.value}</button> : b.value}
            {b.small && <small className="nq-muted" title="Few crew: a handful of tickets changes the rate a lot"> · small base</small>}</td>
          <td className="ci-num">{n(b.crew)}</td>
          <td className="ci-num">{approx}{n(b.tickets)}</td>
          <td><span className="ci-crew__rate"><span className="ci-meter"><i style={{ width: `${Math.max(2, ((b.rate || 0) / top) * 100)}%` }} /></span><strong>{rateText(b.rate)}</strong></span></td>
          <td className="ci-num"><Ratio ratio={b.ratio} /></td>
          <td className="ci-num nq-muted">{rateText(b.previousRate)}</td>
        </tr>)}</tbody>
      </table>
    </div>
    {bases.length > SHOWN && <div><Button small appearance="subtle" onClick={() => setAll((v) => !v)}>{all ? `Show the first ${SHOWN}` : `Show all ${bases.length} bases`}</Button></div>}
    {rates.unmatchedTickets > 0 && <p className="nq-muted">{approx}{n(rates.unmatchedTickets)} tickets are at bases with no crew number: {rates.unmatched.slice(0, 8).map((u) => `${u.value} (${n(u.tickets)})`).join(', ')}{rates.unmatched.length > 8 ? ' …' : ''}. Check the spelling matches the crew file, or add them to it.</p>}
    {rates.withoutValue > 0 && <p className="nq-muted">{approx}{n(rates.withoutValue)} tickets have no {rates.field} and aren’t in the base rates.</p>}
  </Card>;
}
