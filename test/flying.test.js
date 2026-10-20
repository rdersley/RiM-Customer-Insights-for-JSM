import test from 'node:test';
import assert from 'node:assert/strict';
import { flyingFromRoster, sanitizeFlying } from '../src/headcount.js';
import { crewFlyingPerDay, deviceImpact, devicesAffected, fleetForHeadcount, worstDay, DEFAULT_DEVICES } from '../src/devices.js';

const roster = [
  'FlightDate,FlightNumber,DepartureStation,ArrivalStation,CrewCode,Role,InDuty',
  '20/10/2026,FR10,DUB,MAD,AAA,8,FLT',
  '20/10/2026,FR11,MAD,DUB,AAA,8,FLT', // same crew, second sector: counted once
  '20/10/2026,FR10,DUB,MAD,BBB,5,FLT',
  '21/10/2026,FR20,STN,BCN,CCC,8,FLT',
].join('\n');

test('roster: distinct crew a day, averaged, as a share of the crew list', () => {
  const r = flyingFromRoster(roster, 10);
  assert.deepEqual(r.perDay, [{ date: '2026-10-20', crew: 2 }, { date: '2026-10-21', crew: 1 }]);
  assert.equal(r.share, 15); // 1.5 a day of 10
  assert.throws(() => flyingFromRoster('Date,Name\n1,2', 10), /CrewCode/);
  assert.throws(() => flyingFromRoster(roster, 1), /more crew a day/);
  assert.deepEqual(sanitizeFlying({ share: '29.14', days: 2, source: 'r.csv', updatedAt: '2026-10-20T10:00:00.000Z' }), { share: 29.1, usingShare: 100, onePerFlight: null, flightsPerDay: null, days: 2, source: 'r.csv', updatedAt: '2026-10-20T10:00:00.000Z' });
  assert.equal(sanitizeFlying({ share: 29, usingShare: 75.12 }).usingShare, 75.1);
  assert.equal(sanitizeFlying({ share: 29, usingShare: 0 }).usingShare, 100);
  assert.equal(sanitizeFlying({ share: 0 }), null);
  assert.equal(sanitizeFlying(null), null);
});

test('devices are judged against crew flying that day, on the worst single day', () => {
  const config = { ...DEFAULT_DEVICES, idFieldId: 'cf_id', typeFieldId: 'cf_type' };
  const headcount = { values: [{ value: 'STN', count: 1000 }], flying: { share: 30 } };
  assert.equal(crewFlyingPerDay(headcount), 300);
  const { fleet, daily } = fleetForHeadcount(headcount, config);
  assert.equal(daily, true);
  assert.deepEqual(fleet, { vPOS: 300, 'Card reader': 300 });
  assert.deepEqual(fleetForHeadcount({ values: headcount.values }, config).fleet, { vPOS: 1000, 'Card reader': 1000 });
  // 70 vPOS on day 1, 10 on day 2: the worst day (70 of 300 = 23%) suggests P1;
  // the whole period against the whole fleet (80 of 1,000) would only be P2.
  const tickets = [
    ...Array.from({ length: 70 }, (_, i) => ({ fields: { created: '2026-10-20T09:00:00Z', cf_id: `V${i}`, cf_type: 'vPOS' } })),
    ...Array.from({ length: 10 }, (_, i) => ({ fields: { created: '2026-10-21T09:00:00Z', cf_id: `W${i}`, cf_type: 'vPOS' } })),
  ];
  const counts = devicesAffected(tickets, config);
  assert.deepEqual(counts.peak, { vPOS: 70 });
  assert.equal(deviceImpact(worstDay(counts), fleet, config)[0].suggested, 'P1');
  assert.equal(deviceImpact(counts, { vPOS: 1000 }, config)[0].suggested, 'P2');
});

test('one crew member per flight: the roster suggests the share using a device', () => {
  const r = flyingFromRoster(roster, 10);
  assert.equal(r.flightsPerDay, 2); // FR10+FR11 on day 1, FR20 on day 2: 1.5 a day, rounded
  assert.equal(crewFlyingPerDay({ values: [{ value: 'STN', count: 1000 }], flying: { share: 30, usingShare: 75 } }), 225);
});
