import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { agentRows, ratingOf, satisfactionFieldId, teamTotals } from '../src/agents.js';

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

// The resolver: per-agent rows only for Jira admins.
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
        if (path === '/rest/api/3/search/approximate-count') return json({ count: JSON.parse(init.body).jql.includes('resolved >=') ? 4 : 3 });
        if (path === '/rest/api/3/search/jql') {
          const { jql } = JSON.parse(init.body);
          // Every resolved ticket is in the first date slice.
          if (jql.includes('resolved >= "2026-10-01"')) return json({ issues: resolved.slice(0, 4).map((i, n) => ({ key: `SD-${n}`, ...i })) });
          if (jql.includes('statusCategory != Done')) return json({ issues: open.map((i, n) => ({ key: `SD-${10 + n}`, ...i })) });
          return json({ issues: [] });
        }
        return new Response('{}', { status: 404 });
      },
    }),
  },
});
mock.module('@forge/kvs', { namedExports: { kvs: { get: async () => null, set: async () => {}, delete: async () => {} }, WhereConditions: {} } });

test('the resolver sends per-agent rows to Jira admins only', async () => {
  const { handler } = await import('../src/index.js');
  const call = () => handler({ call: { functionKey: 'agentPerformance', payload: { scope: 'internal', projects: ['SD'], startDate: '2026-10-01', endDate: '2026-10-10' } }, context: { accountType: 'licensed' } });
  admin = false;
  const forAgent = await call();
  assert.equal(forAgent.agents, null);
  assert.equal(forAgent.team.resolved, 4);
  assert.equal(forAgent.team.open, 3);
  assert.ok(!JSON.stringify(forAgent).includes('Ann'));
  admin = true;
  const forAdmin = await call();
  assert.deepEqual(forAdmin.agents.map((r) => r.agent.name), ['Ann', 'Bob']);
});
