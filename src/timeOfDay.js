// When tickets are created: a day-of-week × hour grid in a chosen time zone.
// Shared by the analysis (server and browser worker), the AI input and the page.

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAY = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
// "Working hours" for the out-of-hours share: 08:00–18:00, Monday to Friday.
export const WORKING = { from: 8, to: 18, days: 5 };

/** An IANA time zone the runtime knows (e.g. "Europe/Dublin"), or UTC. */
export function validTimeZone(value) {
  const zone = String(value ?? '').trim();
  if (!zone || zone.length > 64) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
    return zone;
  } catch {
    return 'UTC';
  }
}

const formatters = new Map();
const formatterFor = (timeZone) => {
  if (!formatters.has(timeZone)) {
    formatters.set(timeZone, new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'short', hour: '2-digit', hourCycle: 'h23' }));
  }
  return formatters.get(timeZone);
};

/** { day: 0 (Mon)…6 (Sun), hour: 0…23 } for a timestamp in a time zone, or null. */
export function dayAndHour(timestamp, timeZone = 'UTC') {
  const ms = Date.parse(timestamp);
  if (!Number.isFinite(ms)) return null;
  const parts = formatterFor(timeZone).formatToParts(new Date(ms));
  const day = WEEKDAY[parts.find((p) => p.type === 'weekday')?.value];
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  return day === undefined || !Number.isInteger(hour) ? null : { day, hour: hour % 24 };
}

export const emptyGrid = () => DAYS.map(() => new Array(24).fill(0));

/** Ticket counts per [day][hour] for issues with fields.created. */
export function gridOf(issues, timeZone = 'UTC') {
  const grid = emptyGrid();
  for (const issue of issues) {
    const at = dayAndHour(issue?.fields?.created ?? issue?.created, timeZone);
    if (at) grid[at.day][at.hour] += 1;
  }
  return grid;
}

/** Counts per hour (0–23), all days together. */
export const hoursOf = (grid) => new Array(24).fill(0).map((_, h) => grid.reduce((s, row) => s + (row[h] || 0), 0));

export const addGrids = (a, b) => a.map((row, d) => row.map((n, h) => n + (b?.[d]?.[h] || 0)));

/**
 * The busiest `width`-hour window (wrapping past midnight) and its share of
 * all tickets: { from, to, share } with hours 0–23, or null with too few tickets.
 */
export function peakWindow(hours, width = 3, minimum = 5) {
  const total = (hours || []).reduce((s, n) => s + n, 0);
  if (!hours || hours.length !== 24 || total < minimum) return null;
  let best = { from: 0, count: -1 };
  for (let start = 0; start < 24; start += 1) {
    let count = 0;
    for (let k = 0; k < width; k += 1) count += hours[(start + k) % 24];
    if (count > best.count) best = { from: start, count };
  }
  return { from: best.from, to: (best.from + width) % 24, share: Math.round((best.count / total) * 100) };
}

/** Share of tickets created outside 08:00–18:00, Monday to Friday. */
export function outOfHoursShare(grid) {
  const total = grid.reduce((s, row) => s + row.reduce((a, n) => a + n, 0), 0);
  if (!total) return null;
  let inside = 0;
  for (let d = 0; d < WORKING.days; d += 1) for (let h = WORKING.from; h < WORKING.to; h += 1) inside += grid[d][h];
  return Math.round(((total - inside) / total) * 100);
}

const pad = (h) => `${String(h).padStart(2, '0')}:00`;
/** "05:00–08:00". */
export const windowText = (w) => (w ? `${pad(w.from)}–${pad(w.to)}` : '');
