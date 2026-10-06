import test from 'node:test';
import assert from 'node:assert/strict';
import { portalView, reportKey, snapshotFrom } from '../src/publish.js';

const input = {
  organization: { id: '42', name: 'Ryanair Crew' },
  period: { from: '2026-06-01', to: '2026-08-31' },
  totals: { current: 6793, previous: 4484 },
  timeSeries: [{ date: '2026-06-01', count: 410 }, { date: 'bad', count: 1 }],
  patterns: [
    { title: 'vPOS app freezes', summary: 'Crew report the app freezing.', count: 257.4, previousCount: 5, estimated: true, tickets: [{ key: 'SD-1', summary: 'RYR - BOUZYA - STN - vPOS is Stuck' }] },
    { title: '   ', summary: 'no title' },
    ...Array.from({ length: 20 }, (_, i) => ({ title: `Pattern ${i}`, count: i })),
  ],
  overview: 'Volume rose by around half.',
  actions: ['Check release 3.2', ''],
  secretField: 'should not survive',
};

test('snapshots keep themes and counts, and drop tickets and unknown fields', () => {
  const snap = snapshotFrom(input, { now: new Date('2026-09-30T10:00:00Z') });
  assert.equal(snap.totals.changePercent, 51);
  assert.equal(snap.patterns.length, 15);
  assert.deepEqual(snap.patterns[0], { title: 'vPOS app freezes', summary: 'Crew report the app freezing.', count: 257, previousCount: 5, estimated: true });
  assert.equal(JSON.stringify(snap).includes('SD-1'), false);
  assert.equal(JSON.stringify(snap).includes('BOUZYA'), false);
  assert.equal('secretField' in snap, false);
  assert.deepEqual(snap.timeSeries, [{ date: '2026-06-01', count: 410 }]);
  assert.deepEqual(snap.actions, ['Check release 3.2']);
  assert.equal(snap.publishedAt, '2026-09-30T10:00:00.000Z');
});

test('no account ids are stored, and older snapshots that have one hide it', () => {
  assert.equal('publishedBy' in snapshotFrom(input), false);
  const view = portalView({ ...snapshotFrom(input), publishedBy: 'acc-1' }); // as stored by older versions
  assert.equal('publishedBy' in view, false);
  assert.equal(portalView(null), null);
});

test('organisation ids and periods are validated', () => {
  assert.equal(reportKey('42'), 'published-report:42');
  assert.throws(() => reportKey('42:other'));
  assert.throws(() => reportKey('../x'));
  assert.throws(() => snapshotFrom({ ...input, organization: { id: 'abc' } }));
  assert.throws(() => snapshotFrom({ ...input, period: { from: '2026-09-01', to: '2026-08-01' } }));
});
