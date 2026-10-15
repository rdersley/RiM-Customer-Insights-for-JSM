// Contact channel (e.g. the "Issue Received by" field: Phone, Email…): the
// "when tickets arrive" heatmap split by channel, so a customer can see whether
// a peak comes from calls or emails. The channel is read from each analysed
// ticket; no extra Jira calls.
import { DAYS, gridOf, hoursOf, outOfHoursShare, peakWindow, windowText } from './timeOfDay.js';

export const MAX_CHANNELS = 5;
const CHOICE_KINDS = ['option', 'options', 'cascading', 'named', 'strings', 'requestType'];
const clip = (value, length) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, length);

/** The admin's channel field, checked against the site's selectable fields: { id, name, kind } or null. */
export function sanitizeChannelField(input, selectable = []) {
  const id = String(input?.id ?? input ?? '');
  const field = selectable.find((f) => f.id === id && CHOICE_KINDS.includes(f.kind));
  return field ? { id: field.id, name: field.name, kind: field.kind } : null;
}

/** A ticket's channel: the field's (first) value, or a value reduced earlier (`fields.__channel`). */
export function channelOf(issue, field) {
  const f = issue?.fields || {};
  if ('__channel' in f) return f.__channel;
  let value = f[field?.id];
  if (Array.isArray(value)) [value] = value;
  if (field?.kind === 'requestType') value = value?.requestType;
  const text = clip(value?.value ?? value?.name ?? (typeof value === 'string' ? value : ''), 60);
  return text || null;
}

/** Busiest hours, day and out-of-hours share for a heatmap grid. */
export function gridSummary(grid) {
  const total = grid.flat().reduce((a, n) => a + n, 0);
  if (!total) return null;
  const peak = peakWindow(hoursOf(grid));
  const days = grid.map((row) => row.reduce((a, n) => a + n, 0));
  const busiest = days.indexOf(Math.max(...days));
  return {
    busiestHours: peak ? `${windowText(peak)} (${peak.share}%)` : '',
    busiestDay: DAYS[busiest],
    busiestDayShare: Math.round((days[busiest] / total) * 100),
    outOfHours: outOfHoursShare(grid),
  };
}

/**
 * A heatmap per channel for the period's analysed tickets: the biggest
 * MAX_CHANNELS channels, the rest as "Other", and tickets without a value as
 * "Not set". Shares are of the analysed tickets.
 */
export function channelGrids(issues, field, timeZone = 'UTC') {
  if (!field) return null;
  const by = new Map();
  for (const issue of issues || []) {
    const channel = channelOf(issue, field) || 'Not set';
    if (!by.has(channel)) by.set(channel, []);
    by.get(channel).push(issue);
  }
  const total = (issues || []).length;
  if (!total) return null;
  const sorted = [...by.entries()].filter(([name]) => name !== 'Not set').sort((a, b) => b[1].length - a[1].length);
  const groups = sorted.slice(0, MAX_CHANNELS);
  const other = sorted.slice(MAX_CHANNELS).flatMap(([, list]) => list);
  if (other.length) groups.push(['Other', other]);
  if (by.has('Not set')) groups.push(['Not set', by.get('Not set')]);
  return groups.map(([value, list]) => ({ value, tickets: list.length, share: Math.round((list.length / total) * 100), grid: gridOf(list, timeZone) }));
}
