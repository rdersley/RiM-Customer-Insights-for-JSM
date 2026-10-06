import test from 'node:test';
import assert from 'node:assert/strict';
import { matchPreset, presetRange, PRESETS } from '../src/dates.js';

// Wednesday 30 September 2026, mid-afternoon local time.
const now = new Date(2026, 8, 30, 15, 0);

test('week presets start on Monday', () => {
  assert.deepEqual(presetRange('this-week', now), { from: '2026-09-28', to: '2026-09-30' });
  assert.deepEqual(presetRange('last-week', now), { from: '2026-09-21', to: '2026-09-27' });
  const sunday = new Date(2026, 9, 4);
  assert.deepEqual(presetRange('this-week', sunday), { from: '2026-09-28', to: '2026-10-04' });
});

test('month, quarter and year presets', () => {
  assert.deepEqual(presetRange('this-month', now), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(presetRange('last-month', now), { from: '2026-08-01', to: '2026-08-31' });
  assert.deepEqual(presetRange('this-quarter', now), { from: '2026-07-01', to: '2026-09-30' });
  assert.deepEqual(presetRange('last-quarter', now), { from: '2026-04-01', to: '2026-06-30' });
  assert.deepEqual(presetRange('last-quarter', new Date(2026, 1, 10)), { from: '2025-10-01', to: '2025-12-31' });
  assert.deepEqual(presetRange('year-to-date', now), { from: '2026-01-01', to: '2026-09-30' });
});

test('rolling presets include today and stay within the 365-day limit', () => {
  assert.deepEqual(presetRange('last-30', now), { from: '2026-09-01', to: '2026-09-30' });
  assert.deepEqual(presetRange('last-90', now), { from: '2026-07-03', to: '2026-09-30' });
  const year = presetRange('last-12-months', now);
  assert.equal((Date.parse(year.to) - Date.parse(year.from)) / 86400000, 364);
});

test('every preset resolves and matchPreset finds a preset with the same range', () => {
  for (const { key } of PRESETS) {
    const r = presetRange(key, now);
    assert.ok(r.from <= r.to, key);
    // Some presets coincide on some days (on 30 Sep, this month = last 30 days).
    assert.deepEqual(presetRange(matchPreset(r.from, r.to, now), now), r, key);
  }
  assert.equal(matchPreset('2026-06-01', '2026-08-31', now), 'custom');
  assert.equal(presetRange('nope', now), null);
});
