import test from 'node:test';
import assert from 'node:assert/strict';
import { dayAndHour, gridOf, hoursOf, outOfHoursShare, peakWindow, validTimeZone, windowText } from '../src/timeOfDay.js';
import { buildReport, mergeGroups } from '../src/analysis.js';

test('time zones are validated, with UTC as the fallback', () => {
  assert.equal(validTimeZone('Europe/Dublin'), 'Europe/Dublin');
  assert.equal(validTimeZone('Not/AZone'), 'UTC');
  assert.equal(validTimeZone(''), 'UTC');
  assert.equal(validTimeZone(undefined), 'UTC');
});

test('day and hour follow the time zone, including summer time', () => {
  // 1 September 2026 is a Tuesday; Dublin is UTC+1 in summer.
  assert.deepEqual(dayAndHour('2026-09-01T05:30:00Z', 'UTC'), { day: 1, hour: 5 });
  assert.deepEqual(dayAndHour('2026-09-01T05:30:00Z', 'Europe/Dublin'), { day: 1, hour: 6 });
  // Late Sunday in UTC is early Monday in Tokyo.
  assert.deepEqual(dayAndHour('2026-09-06T23:30:00Z', 'Asia/Tokyo'), { day: 0, hour: 8 });
  assert.equal(dayAndHour('not a date'), null);
});

test('the busiest window wraps past midnight, and out-of-hours counts outside 08:00–18:00 Mon–Fri', () => {
  const hours = new Array(24).fill(0);
  hours[23] = 4; hours[0] = 3; hours[1] = 2; hours[12] = 1;
  assert.deepEqual(peakWindow(hours), { from: 23, to: 2, share: 90 });
  assert.equal(windowText(peakWindow(hours)), '23:00–02:00');
  assert.equal(peakWindow(new Array(24).fill(0)), null);
  const grid = gridOf([
    { fields: { created: '2026-09-01T09:00:00Z' } }, // Tue 09:00, inside
    { fields: { created: '2026-09-01T19:00:00Z' } }, // Tue 19:00, outside
    { fields: { created: '2026-09-05T10:00:00Z' } }, // Sat, outside
    { fields: { created: '2026-09-02T17:59:00Z' } }, // Wed 17:59, inside
  ], 'UTC');
  assert.equal(outOfHoursShare(grid), 50);
  assert.equal(hoursOf(grid)[9], 1);
});

test('reports carry a time-of-day grid and each pattern its hours; merged patterns add them up', () => {
  const issue = (key, summary, created) => ({ key, self: `https://x.atlassian.net/rest/api/3/issue/${key}`, fields: { summary, description: '', created, status: { name: 'Open' } } });
  const issues = [
    issue('SD-1', 'Pin pad pairing fails', '2026-09-01T05:10:00Z'),
    issue('SD-2', 'Pin pad pairing fails', '2026-09-02T05:40:00Z'),
    issue('SD-3', 'Pin pad pairing fails', '2026-09-03T06:20:00Z'),
  ];
  const report = buildReport(issues, '2026-09-01', '2026-09-03', null, { timeZone: 'Europe/Dublin' });
  assert.equal(report.timeOfDay.timeZone, 'Europe/Dublin');
  assert.equal(report.timeOfDay.analysed, 3);
  assert.equal(report.timeOfDay.grid[1][6], 1); // Tue 06:xx Dublin
  assert.deepEqual([report.groups[0].hours[6], report.groups[0].hours[7]], [2, 1]);
  const merged = mergeGroups([{ ...report.groups[0], theme: 'a' }, { ...report.groups[0], id: 'y', theme: 'a' }], (g) => g.theme);
  assert.equal(merged[0].hours[6], 4);
  assert.equal(buildReport(issues, '2026-09-01', '2026-09-03', null, { timeZone: 'nope' }).timeOfDay.timeZone, 'UTC');
});
