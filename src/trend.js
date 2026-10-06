// Trend helpers shared by the agent page and the portal, so both describe a
// pattern the same way. Points: [{ date, count, days }] (see patternTrend).

/** New, Rising, Steady or Fading: tickets per day in the second half of the period against the first. */
export function trendWord(points) {
  if (!points || points.length < 4) return '';
  const half = Math.floor(points.length / 2);
  const sum = (list, key) => list.reduce((s, p) => s + (key === 'days' ? p.days || 1 : p.count), 0);
  const early = points.slice(0, half);
  const late = points.slice(points.length - half);
  if (sum(early) + sum(late) < 4) return '';
  const first = sum(early) / sum(early, 'days');
  const second = sum(late) / sum(late, 'days');
  if (!first) return 'New';
  if (second >= first * 1.5) return 'Rising';
  if (second <= first * 0.67) return 'Fading';
  return 'Steady';
}

/** SVG path for a sparkline, drawn as tickets per day so a partial week doesn't look like a dip. */
export function sparkPath(points, width, height) {
  const rates = points.map((p) => p.count / (p.days || 1));
  const max = Math.max(...rates) || 1;
  const step = width / Math.max(1, points.length - 1);
  return rates.map((r, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)},${(height - 1 - (r / max) * (height - 2)).toFixed(1)}`).join(' ');
}

/** 5.5 hours -> "5.5 h"; 50 hours -> "2.1 days". */
export function duration(hours) {
  if (hours === null || hours === undefined) return '–';
  if (hours < 24) return `${hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours)} h`;
  const days = hours / 24;
  return `${days < 10 ? Math.round(days * 10) / 10 : Math.round(days)} days`;
}
