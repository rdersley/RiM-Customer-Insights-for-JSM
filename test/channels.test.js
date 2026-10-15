import test from 'node:test';
import assert from 'node:assert/strict';
import { jsPDF } from 'jspdf';
import { channelGrids, channelOf, gridSummary, sanitizeChannelField } from '../src/channels.js';
import { buildReport } from '../src/analysis.js';
import { snapshotFrom } from '../src/publish.js';
import { pdfContent, portalPdfContent } from '../src/pdfReport.js';
import { buildPdf } from '../static/app/src/exportPdf.js';

const field = { id: 'customfield_77', name: 'Issue Received by', kind: 'option' };
// Phone tickets on Monday mornings, email on Tuesday afternoons.
const ticket = (n, channel, created) => ({ key: `SD-${n}`, fields: { summary: `ticket ${n}`, description: '', created, status: { name: 'Open' }, customfield_77: channel ? { value: channel } : null } });
const tickets = [
  ...[1, 2, 3, 4, 5, 6].map((n) => ticket(n, 'Phone', `2026-10-05T0${8 + (n % 2)}:15:00Z`)),
  ...[7, 8, 9].map((n) => ticket(n, 'Email', `2026-10-06T14:${10 + n}:00Z`)),
  ticket(10, null, '2026-10-07T10:00:00Z'),
];

test('channel field: choice fields only; a ticket\'s channel from its value', () => {
  assert.deepEqual(sanitizeChannelField('customfield_77', [field]), field);
  assert.equal(sanitizeChannelField('customfield_77', [{ ...field, kind: null }]), null);
  assert.equal(channelOf(tickets[0], field), 'Phone');
  assert.equal(channelOf(tickets[9], field), null);
  assert.equal(channelOf({ fields: { __channel: 'Email' } }, field), 'Email');
});

test('a heatmap per channel, biggest first, with shares and peaks', () => {
  const by = channelGrids(tickets, field, 'UTC');
  assert.deepEqual(by.map((c) => [c.value, c.tickets, c.share]), [['Phone', 6, 60], ['Email', 3, 30], ['Not set', 1, 10]]);
  const phone = gridSummary(by[0].grid);
  assert.equal(phone.busiestDay, 'Mon');
  assert.equal(gridSummary(by[1].grid).busiestDay, 'Tue');
  assert.equal(channelGrids(tickets, null), null);
  const report = buildReport(tickets, '2026-10-01', '2026-10-10', null, { channelField: field });
  assert.equal(report.timeOfDay.channelField, 'Issue Received by');
  assert.equal(report.timeOfDay.byChannel[0].value, 'Phone');
});

test('the split reaches the portal snapshot and both PDFs', () => {
  const report = buildReport(tickets, '2026-10-01', '2026-10-10', null, { channelField: field });
  const snapshot = snapshotFrom({ organization: { id: '188', name: 'Ryanair Crew' }, period: { from: '2026-10-01', to: '2026-10-10' }, timeOfDay: report.timeOfDay }, { detailed: true });
  assert.deepEqual(snapshot.timeOfDay.byChannel.map((c) => c.value), ['Phone', 'Email', 'Not set']);
  assert.equal(snapshot.timeOfDay.channelField, 'Issue Received by');
  const portal = portalPdfContent(snapshot);
  assert.equal(portal.timeOfDay.channels[0].value, 'Phone');
  assert.equal(portal.timeOfDay.channels[0].busiestDay, 'Mon');
  const agent = pdfContent({ report: { ...report, organization: 'Ryanair Crew', startDate: '2026-10-01', endDate: '2026-10-10' } });
  assert.equal(agent.timeOfDay.channels.length, 3);
  assert.ok(buildPdf(jsPDF, portal).output().length > 2000);
  // No channel field: no split, and older snapshots still validate.
  assert.equal(snapshotFrom({ organization: { id: '1', name: 'X' }, period: { from: '2026-10-01', to: '2026-10-10' }, timeOfDay: { timeZone: 'UTC', grid: report.timeOfDay.grid } }, { detailed: true }).timeOfDay.byChannel, undefined);
});
