// Flow and workload planning: tickets coming in against tickets resolved, the
// open backlog and its age, and a forecast of the next few weeks for staffing.
// Everything here is plain arithmetic on counts; Jira is queried in index.js.
import { DAYS } from './timeOfDay.js';

const DAY = 86400000;
const WEEK = 7 * DAY;
export const HISTORY_WEEKS = 12;
export const FORECAST_WEEKS = 4;
export const AGE_BANDS = [7, 30, 90]; // days: open for under a week, a month, three months, and longer
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

/** The last `n` whole weeks (Monday to Sunday, UTC) before `now`, oldest first. */
export function pastWeeks(now = Date.now(), n = HISTORY_WEEKS) {
  const today = Date.parse(`${iso(now)}T00:00:00Z`);
  const monday = today - ((new Date(today).getUTCDay() + 6) % 7) * DAY; // this week's Monday
  return Array.from({ length: n }, (_, i) => {
    const from = monday - (n - i) * WEEK;
    return { from: iso(from), toExclusive: iso(from + WEEK) };
  });
}

/**
 * Tickets expected per week for the next `ahead` weeks, from weekly counts
 * (oldest first): a straight-line trend, damped so it can't run away, with a
 * range from how much the weeks vary around it.
 */
export function forecast(weekly, ahead = FORECAST_WEEKS, firstWeek = null) {
  const counts = (weekly || []).map((w) => Number(w.count ?? w) || 0);
  const n = counts.length;
  if (n < 4) return null;
  const mean = counts.reduce((a, c) => a + c, 0) / n;
  const xMean = (n - 1) / 2;
  const sxx = counts.reduce((a, _, i) => a + (i - xMean) ** 2, 0);
  let slope = counts.reduce((a, c, i) => a + (i - xMean) * (c - mean), 0) / sxx;
  // Damp: the trend may move the forecast by at most 30% of the average.
  const cap = (0.3 * mean) / (n - 1 + ahead - xMean || 1);
  slope = Math.max(-cap, Math.min(cap, slope));
  const fitted = (i) => mean + slope * (i - xMean);
  const spread = Math.sqrt(counts.reduce((a, c, i) => a + (c - fitted(i)) ** 2, 0) / Math.max(1, n - 2));
  const start = firstWeek ? Date.parse(`${firstWeek}T00:00:00Z`) : null;
  const weeks = Array.from({ length: ahead }, (_, k) => {
    const expected = Math.max(0, fitted(n + k));
    return {
      from: start !== null ? iso(start + k * WEEK) : null,
      expected: Math.round(expected),
      low: Math.max(0, Math.round(expected - spread)),
      high: Math.round(expected + spread),
    };
  });
  return {
    weeks,
    average: Math.round(mean),
    trendPerWeek: Math.round(slope * 10) / 10,
    direction: Math.abs(slope) < 0.02 * mean ? 'steady' : slope > 0 ? 'rising' : 'falling',
  };
}

/**
 * The busiest hours of the week ahead: each day-and-hour's share of the
 * period's tickets (`grid`, from timeOfDay) applied to the expected week.
 */
export function busiestHours(grid, expectedWeek, top = 5) {
  const total = (grid || []).reduce((a, row) => a + row.reduce((b, c) => b + c, 0), 0);
  if (!total || !expectedWeek) return [];
  const cells = [];
  grid.forEach((row, d) => row.forEach((c, h) => cells.push({ day: DAYS[d], hour: h, expected: (c / total) * expectedWeek })));
  return cells.sort((a, b) => b.expected - a.expected).slice(0, top)
    .map((c) => ({ ...c, expected: Math.round(c.expected * 10) / 10, label: `${c.day} ${String(c.hour).padStart(2, '0')}:00–${String(c.hour + 1).padStart(2, '0')}:00` }));
}

/** Open backlog by age from counts of open tickets created within each band. */
export function backlogAges(open, withinBands) {
  const bands = [];
  let previous = 0;
  AGE_BANDS.forEach((days, i) => {
    const within = Math.min(open, withinBands[i] ?? 0);
    bands.push({ label: i === 0 ? `Under ${days} days` : `${AGE_BANDS[i - 1]}–${days} days`, count: Math.max(0, within - previous) });
    previous = Math.max(previous, within);
  });
  bands.push({ label: `Over ${AGE_BANDS[AGE_BANDS.length - 1]} days`, count: Math.max(0, open - previous) });
  return bands;
}

/** Incoming against resolved per chart bucket, and whether the backlog grew. */
export function flowSummary(created, resolved) {
  const points = created.map((c, i) => ({ date: c.date, created: c.count, resolved: resolved[i] ?? 0 }));
  const totalCreated = points.reduce((a, p) => a + p.created, 0);
  const totalResolved = points.reduce((a, p) => a + p.resolved, 0);
  return { points, created: totalCreated, resolved: totalResolved, net: totalCreated - totalResolved };
}

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/**
 * Where the effort goes: recurring issues ranked by logged work when enough
 * tickets have time logged (at least `minLoggedShare`% of them), otherwise by
 * tickets × typical time to resolve, a rough proxy for time spent. Each row
 * keeps its group index so the page can name it.
 */
export function effortRows(groups, report, { minLoggedShare = 20, top = 10 } = {}) {
  const logged = (report?.effort?.loggedShare || 0) >= minLoggedShare;
  const rows = (groups || []).map((g, index) => {
    const typical = median(g.resolvedHours || []);
    return {
      index,
      count: g.count,
      estimated: Boolean(g.estimated),
      loggedHours: g.loggedHours || 0,
      typicalHours: typical === null ? null : Math.round(typical * 10) / 10,
      ticketHours: typical === null ? 0 : Math.round(g.count * typical),
    };
  });
  const key = logged ? 'loggedHours' : 'ticketHours';
  const total = rows.reduce((a, r) => a + r[key], 0);
  return {
    basis: logged ? 'logged' : 'resolution',
    total: Math.round(total * 10) / 10,
    rows: rows.filter((r) => r[key] > 0).sort((a, b) => b[key] - a[key]).slice(0, top)
      .map((r) => ({ ...r, value: r[key], share: total ? Math.round((r[key] / total) * 100) : 0 })),
  };
}
