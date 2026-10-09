import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_LINKED, problemFields, problemRequest, relatesLinkType } from '../src/problem.js';

const payload = {
  projectKey: ' prb ', issueTypeName: '', summary: 'POS terminal freezes at start of shift', link: true,
  keys: ['SD-1', 'SD-2', 'SD-1', 'not a key', ...Array.from({ length: 30 }, (_, i) => `SD-${100 + i}`)],
  details: { description: 'Crew report the POS freezing.', organisations: 'Acme Airlines', period: '2026-09-01 to 2026-09-30', count: 412.4, previousCount: 241, estimated: true, where: 'Base: LHR 41%', when: 'mostly 05:00–08:00 (62%)', resolution: 'median 7.4 h to resolve', totalKeys: 412 },
};

test('problem requests are validated: project key, summary, unique keys capped at 20', () => {
  const r = problemRequest(payload);
  assert.equal(r.projectKey, 'PRB');
  assert.equal(r.issueTypeName, 'Problem');
  assert.equal(r.keys.length, MAX_LINKED);
  assert.deepEqual(r.keys.slice(0, 3), ['SD-1', 'SD-2', 'SD-100']);
  assert.equal(r.details.count, 412);
  assert.throws(() => problemRequest({ ...payload, projectKey: 'bad key!' }), /project/);
  assert.throws(() => problemRequest({ ...payload, summary: '  ' }), /summary/);
});

test('the description is built on the server with the facts and linked examples', () => {
  const r = problemRequest(payload);
  const fields = problemFields(r, '10050', 'https://x.atlassian.net');
  assert.deepEqual(fields.project, { key: 'PRB' });
  assert.deepEqual(fields.issuetype, { id: '10050' });
  assert.deepEqual(fields.labels, ['customer-insights']);
  const json = JSON.stringify(fields.description);
  assert.match(json, /≈412 \(previous period ≈241\)/);
  assert.match(json, /mostly 05:00–08:00/);
  assert.match(json, /Examples \(20 of 412\)/);
  assert.match(json, /https:\/\/x\.atlassian\.net\/browse\/SD-2/);
  assert.doesNotMatch(JSON.stringify(problemFields(r, '1', '').description), /href/);
});

test('the relates link type is preferred', () => {
  assert.equal(relatesLinkType({ issueLinkTypes: [{ name: 'Blocks', outward: 'blocks' }, { name: 'Relates', outward: 'relates to' }] }).name, 'Relates');
  assert.equal(relatesLinkType({ issueLinkTypes: [{ name: 'Blocks' }] }).name, 'Blocks');
  assert.equal(relatesLinkType({}), null);
});
