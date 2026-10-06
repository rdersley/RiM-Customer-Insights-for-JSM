// Date range presets for the period picker. Local dates (the user's day, not
// UTC), weeks start on Monday, and every range ends no later than today.

const pad = (n) => String(n).padStart(2, '0');
export const localIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const monday = (d) => addDays(d, -((d.getDay() + 6) % 7));
const quarterStart = (d) => new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);

export const PRESETS = [
  { key: 'this-week', label: 'This week' },
  { key: 'last-week', label: 'Last week' },
  { key: 'this-month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
  { key: 'last-30', label: 'Last 30 days' },
  { key: 'last-90', label: 'Last 90 days' },
  { key: 'this-quarter', label: 'This quarter' },
  { key: 'last-quarter', label: 'Last quarter' },
  { key: 'year-to-date', label: 'Year to date' },
  { key: 'last-12-months', label: 'Last 12 months' },
];

/** { from, to } as YYYY-MM-DD, or null for an unknown key. */
export function presetRange(key, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const range = (from, to) => ({ from: localIso(from), to: localIso(to) });
  switch (key) {
    case 'this-week': return range(monday(today), today);
    case 'last-week': return range(addDays(monday(today), -7), addDays(monday(today), -1));
    case 'this-month': return range(new Date(today.getFullYear(), today.getMonth(), 1), today);
    case 'last-month': return range(new Date(today.getFullYear(), today.getMonth() - 1, 1), new Date(today.getFullYear(), today.getMonth(), 0));
    case 'last-30': return range(addDays(today, -29), today);
    case 'last-90': return range(addDays(today, -89), today);
    case 'this-quarter': return range(quarterStart(today), today);
    case 'last-quarter': {
      const start = quarterStart(today);
      return range(new Date(start.getFullYear(), start.getMonth() - 3, 1), addDays(start, -1));
    }
    case 'year-to-date': return range(new Date(today.getFullYear(), 0, 1), today);
    case 'last-12-months': return range(addDays(today, -364), today); // within the 365-day limit
    default: return null;
  }
}

/** The preset a from/to pair matches, or 'custom'. */
export function matchPreset(from, to, now = new Date()) {
  const found = PRESETS.find(({ key }) => {
    const r = presetRange(key, now);
    return r.from === from && r.to === to;
  });
  return found ? found.key : 'custom';
}
