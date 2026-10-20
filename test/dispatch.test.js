import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_DISPATCH, dispatchSection, dispatchSummary, hoursText, hoursToSent, sanitizeDispatch } from '../src/dispatch.js';
import { analysisConfig, sanitizeSettings } from '../src/settings.js';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const config = { ...DEFAULT_DISPATCH, enabled: true, deviceFieldId: 'cf_dev' };
const ticket = (created, device) => ({ id: created, fields: { created, cf_dev: device ? { value: device } : null } });
const change = (at, to) => ({ created: Date.parse(at), items: [{ fieldId: 'status', toString: to }] });

test('time to send: first move to a sent status in the period', () => {
  const t = ticket('2026-10-01T10:00:00Z');
  const h = [change('2026-10-02T10:00:00Z', 'Being Configured'), change('2026-10-03T22:00:00Z', 'Dispatched to Customer'), change('2026-10-05T10:00:00Z', 'Waiting Device Return')];
  assert.equal(hoursToSent(t, h, config.sentStatuses), 60);
  assert.equal(hoursToSent(t, h, config.sentStatuses, Date.parse('2026-10-04T00:00:00Z')), 96); // only moves in the period
  assert.equal(hoursToSent(t, [change('2026-10-02T10:00:00Z', 'Open')], config.sentStatuses), null);
  assert.equal(hoursText(30), '30 h');
  assert.equal(hoursText(26.3 * 24), '26.3 days');
});

test('summary by device: queue against the target, sent times, returns, trend', () => {
  const queue = [ticket('2026-10-20T00:00:00Z', 'Bluepad-50'), ticket('2026-10-10T12:00:00Z', 'Bluepad-50'), ticket('2026-06-01T12:00:00Z', 'vPOS Device Set'), ticket('2026-10-19T12:00:00Z')];
  const sent = [{ device: 'Bluepad-50', hours: 20 }, { device: 'Bluepad-50', hours: 600 }, { device: 'vPOS Device Set', hours: 40 }];
  const weekly = [10, 11, 12, 13].map((c, i) => ({ from: `2026-09-${10 + i * 7}`, created: 20, sent: c }));
  const d = dispatchSummary({ queue, sent, returns: [ticket('2026-09-01T00:00:00Z', 'Bluepad-50')], weekly, config, now: NOW });
  assert.equal(d.queue.total, 4);
  assert.equal(d.queue.overTarget, 2);
  assert.equal(d.queue.oldestDays, 141);
  assert.deepEqual(d.queue.bands.map((b) => b.count), [2, 0, 1, 0, 1]);
  assert.deepEqual([d.sent.sent, d.sent.withinTarget, d.sent.withinShare], [3, 2, 67]);
  const bp = d.byDevice.find((r) => r.device === 'Bluepad-50');
  assert.deepEqual([bp.queue, bp.overTarget, bp.sent, bp.withinShare, bp.returns], [2, 1, 2, 50, 1]);
  assert.ok(d.byDevice.some((r) => r.device === '(not set)'));
  assert.deepEqual(d.trend, { createdPerWeek: 20, sentPerWeek: 11.5, net: 8.5, clearWeeks: null });
  assert.match(dispatchSection(d).lines.join(' '), /growing by about 8.5 a week/);
});

test('dispatch is set per project and only shown when switched on', () => {
  assert.deepEqual(sanitizeDispatch({ enabled: true, deviceFieldId: 'x', queueStatuses: 'Open\nPending Stock', targetHours: '0' }, [{ id: 'cf_dev' }]),
    { ...DEFAULT_DISPATCH, enabled: true, queueStatuses: ['Open', 'Pending Stock'], returnStatuses: [] });
  const settings = sanitizeSettings({ projectProfiles: [{ id: 'p-hw-12345', name: 'Hardware', projects: ['HW'], dispatch: { enabled: true, deviceFieldId: 'cf_dev' } }] }, [{ id: 'cf_dev', name: 'Device Type', kind: 'option' }]);
  assert.equal(analysisConfig(settings, { scope: 'internal', projects: ['HW'] }).dispatch.deviceFieldId, 'cf_dev');
  assert.equal(analysisConfig(settings, { scope: 'internal', projects: ['SD'] }).dispatch, undefined);
});
