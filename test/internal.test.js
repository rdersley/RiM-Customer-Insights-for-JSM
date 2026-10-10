import test from 'node:test';
import assert from 'node:assert/strict';
import { parseQuery } from '../src/engine.js';
import { buildReport } from '../src/analysis.js';
import { clientFieldList, dimensionsOf, internalBreakdowns, jqlClause, jqlEmptyClause, sanitizeSettings } from '../src/settings.js';
import { backlogAges, busiestHours, effortRows, flowSummary, forecast, pastWeeks } from '../src/flow.js';

const clientFields = [{ id: 'customfield_100', name: 'SD Client', kind: 'option' }, { id: 'customfield_200', name: 'Client', kind: 'option' }];
const period = { startDate: '2026-09-01', endDate: '2026-09-30' };

test('internal scope: projects and clients, with the client read from any client field', () => {
  const q = parseQuery({ scope: 'internal', projects: ['sd', 'IT'], clients: ['Ryanair', 'Ryanair'], ...period }, null, { clientFields });
  assert.equal(q.internal, true);
  assert.equal(q.label, 'SD, IT · Ryanair');
  assert.deepEqual(q.organizations, []);
  assert.equal(q.scopeJql, `project in ('SD', 'IT') AND (cf[100] in ("Ryanair") OR cf[200] in ("Ryanair"))`);
  assert.equal(q.between('2026-09-01', '2026-10-01'), `project in ('SD', 'IT') AND (cf[100] in ("Ryanair") OR cf[200] in ("Ryanair")) AND created >= "2026-09-01" AND created < "2026-10-01"`);
  // A client across every project.
  assert.equal(parseQuery({ scope: 'internal', clients: ['Jet2'], ...period }, null, { clientFields: clientFields.slice(1) }).scopeJql, 'cf[200] in ("Jet2")');
  // A drill-down filter goes on the end.
  assert.match(parseQuery({ scope: 'internal', projects: ['SD'], ...period }, { clause: 'priority = "P1"' }).between('2026-09-01', '2026-10-01'), /created < "2026-10-01" AND priority = "P1"$/);
  assert.throws(() => parseQuery({ scope: 'internal', ...period }), /at least one project or client/);
  assert.throws(() => parseQuery({ scope: 'internal', clients: ['X'], ...period }), /client fields/);
  assert.throws(() => parseQuery({ scope: 'internal', projects: ['SD'], clients: ['"]); DROP'], ...period }, null, { clientFields: [] }), /client fields/);
  // Quotes in a client name are escaped.
  assert.match(parseQuery({ scope: 'internal', clients: ['A "B"'], ...period }, null, { clientFields }).scopeJql, /cf\[100\] in \("A \\"B\\""\)/);
});

test('customer analyses are unchanged', () => {
  const q = parseQuery({ organization: { id: '188', name: 'Ryanair Crew' }, projects: ['SD'], ...period });
  assert.equal(q.internal, false);
  assert.equal(q.between('2026-09-01', '2026-10-01'), `organizations = "Ryanair Crew" AND created >= "2026-09-01" AND created < "2026-10-01" AND project in ('SD')`);
  assert.equal(q.scopeJql, `organizations = "Ryanair Crew" AND project in ('SD')`);
});

test('client fields: choice custom fields only; Project and Client breakdowns for internal analyses', () => {
  const selectable = [...clientFields, { id: 'labels', name: 'Labels', kind: 'strings' }, { id: 'customfield_300', name: 'Team', kind: 'named' }];
  assert.deepEqual(clientFieldList(['customfield_100', 'labels', 'customfield_300', 'customfield_200', 'customfield_100'], selectable), clientFields);
  assert.deepEqual(sanitizeSettings({ clientFields: ['customfield_200'] }, selectable).clientFields, [clientFields[1]]);
  assert.deepEqual(internalBreakdowns({ projects: ['SD', 'IT'], clients: [] }, clientFields).map((b) => b.id), ['project', 'client']);
  assert.deepEqual(internalBreakdowns({ projects: ['SD'], clients: ['Ryanair'] }, clientFields), []);
  const client = internalBreakdowns({ projects: [] }, clientFields)[1];
  assert.deepEqual(dimensionsOf({ fields: { customfield_200: { value: 'Jet2' } } }, [client]), { client: ['Jet2'] });
  assert.deepEqual(dimensionsOf({ fields: { customfield_100: { value: 'Ryanair' } } }, [client]), { client: ['Ryanair'] });
  assert.equal(jqlClause(client, 'Jet2'), '(cf[100] = "Jet2" OR cf[200] = "Jet2")');
  assert.equal(jqlEmptyClause(client), 'cf[100] is EMPTY AND cf[200] is EMPTY');
  assert.equal(jqlClause({ id: 'project', kind: 'named' }, 'IT Help'), 'project = "IT Help"');
});

const issue = (key, summary, created, { timespent = 0, resolved = null } = {}) => ({ key, fields: { summary, description: '', created, resolutiondate: resolved, status: { name: resolved ? 'Done' : 'Open' }, timespent } });

test('effort: logged time per recurring issue, or tickets × time to resolve as a fallback', () => {
  const issues = [
    issue('IT-1', 'VPN not connecting', '2026-09-02T09:00:00Z', { timespent: 7200, resolved: '2026-09-02T13:00:00Z' }),
    issue('IT-2', 'VPN not connecting at home', '2026-09-03T09:00:00Z', { timespent: 3600, resolved: '2026-09-03T11:00:00Z' }),
    issue('IT-3', 'Laptop screen broken', '2026-09-04T09:00:00Z', { timespent: 36000, resolved: '2026-09-06T09:00:00Z' }),
    issue('IT-4', 'Laptop screen broken again', '2026-09-05T09:00:00Z', { timespent: 0, resolved: '2026-09-07T09:00:00Z' }),
  ];
  const report = buildReport(issues, '2026-09-01', '2026-09-30', null, {});
  assert.equal(report.effort.loggedHours, 13);
  assert.equal(report.effort.loggedShare, 75);
  const logged = effortRows(report.groups, report);
  assert.equal(logged.basis, 'logged');
  assert.equal(logged.rows[0].loggedHours, 10);
  assert.match(report.groups[logged.rows[0].index].theme, /laptop|screen/i);
  assert.equal(logged.rows[0].share, 77);
  const proxy = effortRows(report.groups, { effort: { loggedShare: 5 } });
  assert.equal(proxy.basis, 'resolution');
  assert.equal(proxy.rows[0].ticketHours, 96); // 2 tickets × 48 h
});

test('forecast: a damped trend with a range; history weeks are whole Monday weeks', () => {
  const weeks = pastWeeks(Date.parse('2026-10-08T12:00:00Z'), 3); // a Thursday
  assert.deepEqual(weeks, [{ from: '2026-09-14', toExclusive: '2026-09-21' }, { from: '2026-09-21', toExclusive: '2026-09-28' }, { from: '2026-09-28', toExclusive: '2026-10-05' }]);
  const flat = forecast([100, 100, 100, 100, 100, 100], 2, '2026-10-12');
  assert.deepEqual(flat.weeks.map((w) => [w.from, w.expected, w.low, w.high]), [['2026-10-12', 100, 100, 100], ['2026-10-19', 100, 100, 100]]);
  assert.equal(flat.direction, 'steady');
  const rising = forecast([10, 20, 30, 40, 50, 60, 70, 80], 4);
  assert.equal(rising.direction, 'rising');
  // Damped: no more than 30% above the average by the last forecast week.
  assert.ok(rising.weeks[3].expected <= Math.round(45 * 1.3) + 1);
  assert.equal(forecast([1, 2, 3]), null);
  const falling = forecast([50, 40, 30, 20, 10, 0, 0, 0], 4);
  assert.ok(falling.weeks.every((w) => w.expected >= 0 && w.low >= 0));
});

test('backlog ages, flow and the busiest hours of the week ahead', () => {
  assert.deepEqual(backlogAges(100, [10, 40, 70]).map((b) => [b.label, b.count]), [['Under 7 days', 10], ['7–30 days', 30], ['30–90 days', 30], ['Over 90 days', 30]]);
  assert.deepEqual(flowSummary([{ date: 'a', count: 5 }, { date: 'b', count: 7 }], [4, 10]), { points: [{ date: 'a', created: 5, resolved: 4 }, { date: 'b', created: 7, resolved: 10 }], created: 12, resolved: 14, net: -2 });
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  grid[0][9] = 30; grid[0][10] = 10;
  const peaks = busiestHours(grid, 80, 2);
  assert.deepEqual(peaks.map((p) => [p.label, p.expected]), [['Mon 09:00–10:00', 60], ['Mon 10:00–11:00', 20]]);
  assert.deepEqual(busiestHours(grid, 0), []);
});
