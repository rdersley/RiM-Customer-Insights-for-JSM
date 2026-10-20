import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { agentRows, handlingTimes, isHandlingStatus, ratingOf, satisfactionFieldId, teamTotals } from '../src/agents.js';

const NOW = Date.parse('2026-10-12T12:00:00Z');
const SLA = 'customfield_500';
const CSAT = 'customfield_600';
const ann = { accountId: 'a1', displayName: 'Ann' };
const bob = { accountId: 'b2', displayName: 'Bob' };
const resolvedIssue = (assignee, hours, { sla = { completedCycles: [{ breached: false }] }, rating = null, type = 'Incident', priority = 'P3', timespent = 0 } = {}) => ({
  fields: { assignee, created: '2026-10-01T09:00:00Z', resolutiondate: new Date(Date.parse('2026-10-01T09:00:00Z') + hours * 3600000).toISOString(), timespent, issuetype: { name: type }, priority: { name: priority }, [SLA]: sla, [CSAT]: rating ? { rating } : null },
});
const openIssue = (assignee, created) => ({ fields: { assignee, created } });

const resolved = [
  resolvedIssue(ann, 2, { rating: 5, timespent: 3600 }),
  resolvedIssue(ann, 4, { rating: 3, priority: 'P1' }),
  resolvedIssue(ann, 10, { sla: { completedCycles: [{ breached: true }] }, type: 'Service request' }),
  resolvedIssue(bob, 30, { priority: 'P2' }),
  resolvedIssue(null, 1),
];
const open = [openIssue(ann, '2026-10-10T12:00:00Z'), openIssue(bob, '2026-09-12T12:00:00Z'), openIssue(bob, '2026-10-11T12:00:00Z')];
const options = { slaFields: [{ id: SLA, name: 'Time to resolution' }], satisfactionId: CSAT, now: NOW };

test('per agent: resolved, typical time, SLA, satisfaction, logged time, mix and open work', () => {
  const rows = agentRows(resolved, open, options);
  assert.deepEqual(rows.map((r) => r.agent.name), ['Ann', 'Bob', 'Unassigned']);
  const a = rows[0];
  assert.equal(a.resolved, 3);
  assert.equal(a.medianHours, 4);
  assert.deepEqual(a.sla[SLA], { met: 2, breached: 1, metShare: 67 });
  assert.equal(a.rating, 4);
  assert.equal(a.rated, 2);
  assert.equal(a.loggedHours, 1);
  assert.equal(a.urgentShare, 33);
  assert.deepEqual(a.topTypes, [{ name: 'Incident', share: 67 }, { name: 'Service request', share: 33 }]);
  assert.equal(a.open, 1);
  const b = rows[1];
  assert.equal(b.open, 2);
  assert.equal(b.oldestOpenDays, 30);
  assert.equal(b.rating, null);
  assert.equal(b.urgentShare, 100);
});

test('team totals cover everyone, without names', () => {
  const t = teamTotals(resolved, open, options);
  assert.equal(t.resolved, 5);
  assert.equal(t.agents, 2);
  assert.equal(t.open, 3);
  assert.equal(t.medianHours, 4);
  assert.equal(t.agent.name, 'Team');
  assert.equal(ratingOf({ rating: 6 }), null);
  assert.equal(satisfactionFieldId([{ id: CSAT, schema: { custom: 'com.atlassian.servicedesk:sd-request-feedback' } }]), CSAT);
});

// ---- AHT ----------------------------------------------------------------------
const statusById = new Map([
  ['1', { name: 'Open', category: 'new' }],
  ['3', { name: 'In Progress', category: 'indeterminate' }],
  ['4', { name: 'Waiting for customer', category: 'indeterminate' }],
  ['5', { name: 'Done', category: 'done' }],
]);
const at = (h) => new Date(Date.parse('2026-10-01T09:00:00Z') + h * 3600000).toISOString();
const ticket = { id: '100', fields: { created: at(0), resolutiondate: at(5), status: { id: '5' }, assignee: { accountId: 'b2' } } };
const histories = [
  { created: at(1), items: [{ fieldId: 'status', from: '1', to: '3' }] },
  { created: at(2), items: [{ fieldId: 'assignee', from: 'a1', fromString: 'Ann', to: 'b2', toString: 'Bob' }] },
  { created: at(3), items: [{ fieldId: 'status', from: '3', to: '4' }] },
  { created: at(4), items: [{ fieldId: 'status', from: '4', to: '3' }] },
  { created: at(5), items: [{ fieldId: 'status', from: '3', to: '5' }] },
];

test('AHT: in-progress time per assignee from the ticket history; waiting time does not count', () => {
  assert.equal(isHandlingStatus({ name: 'In Progress', category: 'indeterminate' }), true);
  assert.equal(isHandlingStatus({ name: 'Waiting for customer', category: 'indeterminate' }), false);
  assert.equal(isHandlingStatus({ name: 'Open', category: 'new' }), false);
  assert.equal(isHandlingStatus({ name: 'Triage', category: 'new' }, ['triage']), true);
  // Ann 09–10 Open, 10–11 In Progress (1 h); Bob 11–12 In Progress (1 h), 12–13 waiting, 13–14 In Progress (1 h).
  assert.deepEqual(handlingTimes(ticket, [...histories].reverse(), statusById), { a1: 3600000, b2: 7200000 });
  // Statuses chosen in settings instead.
  assert.deepEqual(handlingTimes(ticket, histories, statusById, ['Waiting for customer']), { b2: 3600000 });
  // No history: the current status and assignee for the whole time.
  assert.deepEqual(handlingTimes({ id: '1', fields: { created: at(0), resolutiondate: at(2), status: { id: '3' }, assignee: { accountId: 'a1' } } }, [], statusById), { a1: 7200000 });
});

test('AHT per agent and for the team', () => {
  const t1 = { ...ticket, fields: { ...ticket.fields, assignee: bob } };
  const t2 = { id: '101', fields: { created: at(0), resolutiondate: at(1), assignee: ann } };
  const handling = { 100: { a1: 3600000, b2: 7200000 }, 101: { a1: 1800000 } };
  const rows = agentRows([t1, t2], [], { handling, names: { a1: 'Ann', b2: 'Bob' } });
  const ann1 = rows.find((r) => r.agent.id === 'a1');
  const bob1 = rows.find((r) => r.agent.id === 'b2');
  assert.deepEqual([ann1.handled, ann1.handlingHours, ann1.ahtHours], [2, 1.5, 0.8]);
  assert.deepEqual([bob1.handled, bob1.handlingHours, bob1.ahtHours], [1, 2, 2]);
  const team = teamTotals([t1, t2], [], { handling });
  assert.deepEqual([team.handled, team.handlingHours, team.ahtHours], [2, 3.5, 1.8]);
});

// The resolver: per-agent rows for every agent, admin or not.
let admin = false;
mock.module('@forge/api', {
  namedExports: {
    route: (strings, ...values) => strings.reduce((out, s, i) => out + s + (i < values.length ? encodeURIComponent(values[i]) : ''), ''),
    asApp: () => ({ requestJira: async () => new Response('{}') }),
    asUser: () => ({
      requestJira: async (path, init = {}) => {
        const json = (body) => new Response(JSON.stringify(body), { status: 200 });
        if (path.startsWith('/rest/api/3/mypermissions')) return json({ permissions: { ADMINISTER: { havePermission: admin } } });
        if (path === '/rest/api/3/field') return json([{ id: CSAT, schema: { custom: 'com.atlassian.servicedesk:sd-request-feedback' } }]);
        if (path === '/rest/api/3/status') return json([{ id: '3', name: 'In Progress', statusCategory: { key: 'indeterminate' } }]);
        if (path === '/rest/api/3/changelog/bulkfetch') return json({ issueChangeLogs: JSON.parse(init.body).issueIdsOrKeys.map((id) => ({ issueId: id, changeHistories: [] })) });
        if (path === '/rest/api/3/search/approximate-count') return json({ count: JSON.parse(init.body).jql.includes('resolved >=') ? 4 : 3 });
        if (path === '/rest/api/3/search/jql') {
          const { jql } = JSON.parse(init.body);
          // Every resolved ticket is in the first date slice.
          if (jql.includes('resolved >= "2026-10-01"')) return json({ issues: resolved.slice(0, 4).map((i, n) => ({ id: String(200 + n), key: `SD-${n}`, ...i, fields: { ...i.fields, status: { id: '3' } } })) });
          if (jql.includes('statusCategory != Done')) return json({ issues: open.map((i, n) => ({ key: `SD-${10 + n}`, ...i })) });
          return json({ issues: [] });
        }
        return new Response('{}', { status: 404 });
      },
    }),
  },
});
mock.module('@forge/kvs', { namedExports: { kvs: { get: async () => null, set: async () => {}, delete: async () => {} }, WhereConditions: {} } });

test('the resolver sends per-agent rows to every agent, not only Jira admins', async () => {
  const { handler } = await import('../src/index.js');
  const call = () => handler({ call: { functionKey: 'agentPerformance', payload: { scope: 'internal', projects: ['SD'], startDate: '2026-10-01', endDate: '2026-10-10' } }, context: { accountType: 'licensed' } });
  // Never for customer analyses, admin or not.
  admin = true;
  await assert.rejects(handler({ call: { functionKey: 'agentPerformance', payload: { organization: { id: '188', name: 'Ryanair Crew' }, startDate: '2026-10-01', endDate: '2026-10-10' } }, context: { accountType: 'licensed' } }), /only available on the Internal tab/);
  admin = false;
  const forAgent = await call();
  assert.deepEqual(forAgent.agents.map((r) => r.agent.name), ['Ann', 'Bob']);
  assert.equal(forAgent.team.resolved, 4);
  assert.equal(forAgent.team.open, 3);
  admin = true;
  const forAdmin = await call();
  assert.deepEqual(forAdmin.agents.map((r) => r.agent.name), ['Ann', 'Bob']);
  // No history in the mock: each ticket was In Progress from creation to resolution.
  assert.equal(forAdmin.handling.complete, true);
  assert.deepEqual(forAdmin.agents.map((r) => r.ahtHours), [5.3, 30]);
});

test('history times as dates or epoch numbers, duplicates counted once', async () => {
  const { changeTime } = await import('../src/agents.js');
  const iso = '2026-10-01T10:00:00.000Z';
  assert.equal(changeTime(iso), Date.parse(iso));
  assert.equal(changeTime(Date.parse(iso)), Date.parse(iso));
  assert.equal(changeTime(Date.parse(iso) / 1000), Date.parse(iso));
  assert.equal(changeTime(String(Date.parse(iso))), Date.parse(iso));
  const epoch = histories.map((h, i) => ({ ...h, id: String(i), created: Date.parse(h.created) }));
  assert.deepEqual(handlingTimes(ticket, [...epoch, ...epoch], statusById), { a1: 3600000, b2: 7200000 });
  const stats = { seen: {}, handled: 0, unassigned: 0 };
  handlingTimes(ticket, epoch, statusById, ['In Progress 1st Level'], Date.now(), stats);
  assert.equal(stats.handled, 0);
  assert.deepEqual(Object.keys(stats.seen).sort(), ['Done', 'In Progress', 'Open', 'Waiting for customer']);
  // Unassigned while in progress: whoever moved it there.
  const moved = [{ id: 'm', created: at(1), author: { accountId: 'c3' }, items: [{ fieldId: 'status', from: '1', to: '3' }] }];
  assert.deepEqual(handlingTimes({ id: '9', fields: { created: at(0), resolutiondate: at(2), status: { id: '3' }, assignee: null } }, moved, statusById), { c3: 3600000 });
});

test('AHT in minutes for display', async () => {
  const { minutesText, agentRows: rows } = await import('../src/agents.js');
  assert.deepEqual([minutesText(null), minutesText(0), minutesText(4), minutesText(60), minutesText(80)], ['–', 'under 1 min', '4 min', '1 h', '1 h 20 min']);
  const [r] = rows([{ id: '1', fields: { created: at(0), resolutiondate: at(1), assignee: ann } }], [], { handling: { 1: { a1: 4 * 60000 + 20000 } } });
  assert.equal(r.ahtMinutes, 4);
  assert.equal(r.ahtHours, 0.1);
});
