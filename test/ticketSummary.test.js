import test from 'node:test';
import assert from 'node:assert/strict';
import { BACKFILL_LIMITS, SUMMARY_PROPERTY, changedJql, fieldValue, hash, sanitizeTicketSummary, sourceFingerprint, summaryFieldChoices, summaryInput } from '../src/ticketSummary.js';
import { parseSummary, summariseTicket } from '../src/ticketSummaryAi.js';
import { runOnce, summariseIssue } from '../src/ticketSummaryJobs.js';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../src/settings.js';

const doc = (...paragraphs) => ({ type: 'doc', version: 1, content: paragraphs.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })) });
const ORG = { id: '188', name: 'Ryanair Crew' };
const config = { enabled: true, organizations: [ORG], fieldId: 'customfield_200', fieldKind: 'textarea', backfillDays: 30 };
const choices = [{ id: 'customfield_200', name: 'Ticket overview', kind: 'textarea' }, { id: 'customfield_201', name: 'Short note', kind: 'text' }];

const issue = (key, { description = doc('vPOS at STN stuck on the sync screen since this morning.'), comments = [], marker } = {}) => ({
  key,
  fields: { summary: 'FW: urgent', status: { name: 'Waiting for support' }, created: '2026-10-20T08:00:00.000+0000', customfield_10010: { requestType: { name: 'Device issue' } }, description, comment: { total: comments.length, comments } },
  properties: marker ? { [SUMMARY_PROPERTY]: marker } : {},
});

function fakeJira({ pages = {}, publicComments = {} } = {}) {
  const calls = { search: [], comments: [], writes: [], properties: [] };
  return {
    calls,
    async search(jql, fieldId, token) { calls.search.push({ jql, token }); const list = Object.entries(pages).find(([prefix]) => jql.includes(prefix))?.[1] || [{ issues: [] }]; const index = token ? Number(token) : 0; return { issues: list[index]?.issues || [], nextPageToken: index + 1 < list.length ? String(index + 1) : '' }; },
    async publicComments(key) { calls.comments.push(key); return publicComments[key] || []; },
    async writeField(key, fieldId, value) { calls.writes.push({ key, fieldId, value }); },
    async setProperty(key, value) { calls.properties.push({ key, value }); },
  };
}
const fakeSummarise = () => { const seen = []; const fn = async (input) => { seen.push(input); return { summary: `Summary of ${input.title}: vPOS stuck on sync at STN.`, model: 'claude-sonnet-5' }; }; fn.seen = seen; return fn; };

test('field choices: single-line and paragraph custom text fields only', () => {
  const list = summaryFieldChoices([
    { id: 'customfield_200', name: 'Ticket overview', custom: true, schema: { type: 'string', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:textarea' } },
    { id: 'customfield_201', name: 'Short note', custom: true, schema: { type: 'string', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:textfield' } },
    { id: 'description', name: 'Description', custom: false, schema: { type: 'string', system: 'description' } },
    { id: 'customfield_300', name: 'Base', custom: true, schema: { type: 'option', custom: 'com.atlassian.jira.plugin.system.customfieldtypes:select' } },
  ]);
  assert.deepEqual(list, choices.slice().sort((a, b) => a.name.localeCompare(b.name)));
});

test('settings: off by default, known organisations and fields only', () => {
  assert.equal(DEFAULT_SETTINGS.ticketSummary.enabled, false);
  const s = sanitizeTicketSummary({ enabled: true, organizations: [{ id: '188' }, { id: '999' }, '188'], fieldId: 'customfield_999', backfillDays: 500 }, [ORG], choices);
  assert.deepEqual(s.organizations, [ORG]);
  assert.equal(s.fieldId, '');
  assert.equal(s.backfillDays, BACKFILL_LIMITS.default);
  const ok = sanitizeTicketSummary({ enabled: true, organizations: [ORG], fieldId: 'customfield_201', backfillDays: 7 }, [ORG], choices);
  assert.equal(ok.fieldKind, 'text');
  assert.equal(ok.backfillDays, 7);
  const all = sanitizeSettings({ ticketSummary: { enabled: true, organizations: [ORG], fieldId: 'customfield_200' } }, [], [ORG], { summaryChoices: choices });
  assert.equal(all.ticketSummary.fieldKind, 'textarea');
});

test('changed tickets are found per organisation, quiet for 20 minutes', () => {
  assert.equal(changedJql([ORG], 27.2), 'organizations = "Ryanair Crew" AND updated >= -28m AND updated <= -20m ORDER BY updated ASC');
  assert.match(changedJql([ORG, { id: '2', name: 'Say "hi"' }], 5), /organizations in \("Ryanair Crew", "Say \\"hi\\""\)/);
});

test('fingerprint changes with comments, not with the app writing the summary field', () => {
  const a = issue('SD-1');
  const withField = { ...a, fields: { ...a.fields, customfield_200: doc('Old summary') } };
  assert.equal(sourceFingerprint(a.fields), sourceFingerprint(withField.fields));
  const commented = issue('SD-1', { comments: [{ id: '1', created: '2026-10-20T09:00:00.000+0000' }] });
  assert.notEqual(sourceFingerprint(a.fields), sourceFingerprint(commented.fields));
});

test('model input: plain text description, public comments only as given, bounded', () => {
  const input = summaryInput(issue('SD-1', { description: doc('Line one', 'x'.repeat(9000)) }), [{ body: 'We have reset the device.', created: { iso8601: '2026-10-20T10:00:00+0000' } }, { body: '   ' }]);
  assert.equal(input.title, 'FW: urgent');
  assert.equal(input.requestType, 'Device issue');
  assert.ok(input.description.startsWith('Line one\n'));
  assert.ok(input.description.length <= 6000);
  assert.deepEqual(input.comments, [{ created: '2026-10-20', text: 'We have reset the device.' }]);
});

test('unchanged ticket: no comment fetch, no AI, no write', async () => {
  const t = issue('SD-1');
  const jira = fakeJira();
  const summarise = fakeSummarise();
  const result = await summariseIssue({ ...t, properties: { [SUMMARY_PROPERTY]: { source: sourceFingerprint(t.fields) } } }, config, { jira, summarise });
  assert.equal(result, 'unchanged');
  assert.equal(jira.calls.comments.length + jira.calls.writes.length + summarise.seen.length, 0);
});

test('only an internal comment changed: marker updated, no AI call', async () => {
  const before = issue('SD-1');
  const input = summaryInput(before, []);
  const after = issue('SD-1', { comments: [{ id: '9', created: '2026-10-20T11:00:00.000+0000' }], marker: { v: 1, source: sourceFingerprint(before.fields), input: hash(JSON.stringify(input)), at: '2026-10-20T09:00:00.000Z' } });
  const jira = fakeJira(); // the public comments API returns nothing new
  const summarise = fakeSummarise();
  assert.equal(await summariseIssue(after, config, { jira, summarise }), 'unchanged');
  assert.equal(summarise.seen.length, 0);
  assert.equal(jira.calls.writes.length, 0);
  assert.equal(jira.calls.properties[0].value.source, sourceFingerprint(after.fields));
});

test('a new public comment: summarised from description and public comments, written without notifying', async () => {
  const t = issue('SD-1', { comments: [{ id: '1' }, { id: '2' }] });
  const jira = fakeJira({ publicComments: { 'SD-1': [{ body: 'Please try a restart.', created: { iso8601: '2026-10-20T10:00:00+0000' } }] } });
  const summarise = fakeSummarise();
  assert.equal(await summariseIssue(t, config, { jira, summarise, now: () => new Date('2026-10-20T12:00:00Z') }), 'summarised');
  assert.deepEqual(summarise.seen[0].comments.map((c) => c.text), ['Please try a restart.']);
  assert.equal(jira.calls.writes[0].fieldId, 'customfield_200');
  assert.equal(jira.calls.writes[0].value.type, 'doc');
  assert.equal(jira.calls.properties[0].value.at, '2026-10-20T12:00:00.000Z');
});

test('a ticket with no description or public comments is left alone', async () => {
  const jira = fakeJira();
  const summarise = fakeSummarise();
  assert.equal(await summariseIssue(issue('SD-2', { description: null }), config, { jira, summarise }), 'empty');
  assert.equal(summarise.seen.length + jira.calls.writes.length, 0);
});

test('field values: paragraph as a document, single line cut at 255 on a word', () => {
  const long = 'word '.repeat(80).trim();
  const short = fieldValue(long, 'text');
  assert.ok(short.length <= 255 && short.endsWith('…') && !short.includes('wor…'));
  assert.equal(fieldValue('Hi there', 'textarea').content[0].content[0].text, 'Hi there');
});

test('AI call: forced tool, bounded summary, empty replies rejected', async () => {
  let request;
  const chatFn = async (r) => { request = r; return { choices: [{ message: { tool_calls: [{ function: { name: 'ticket_summary', arguments: JSON.stringify({ summary: '  The vPOS   at STN is stuck. ' }) } }] } }] }; };
  const { summary } = await summariseTicket({ title: 'x', comments: [] }, { chatFn, models: ['m'] });
  assert.equal(summary, 'The vPOS at STN is stuck.');
  assert.equal(request.tool_choice.function.name, 'ticket_summary');
  assert.match(request.messages[0].content, /No names of individuals/);
  assert.equal(parseSummary({ summary: 'short' }), '');
  assert.equal(parseSummary({ summary: 'y'.repeat(2000) }).length, 700);
});

function fakeStore(settings, state = {}) {
  const store = { state, async loadSettings() { return { ...DEFAULT_SETTINGS, ...settings }; }, async loadTicketSummaryState() { return store.state; }, async saveTicketSummaryState(s) { store.state = s; } };
  return store;
}

test('job: does nothing until turned on with organisations and a field', async () => {
  const jira = fakeJira();
  assert.equal(await runOnce({ jira, store: fakeStore({ ticketSummary: { ...config, fieldId: '' } }), summarise: fakeSummarise() }), null);
  assert.equal(jira.calls.search.length, 0);
});

test('job: summarises changed tickets, moves the cursor, works through the backfill', async () => {
  const NOW = Date.parse('2026-10-20T12:00:00Z');
  const jira = fakeJira({ pages: {
    'updated >= -': [{ issues: [issue('SD-1')] }],
    'created >= -30d': [{ issues: [issue('SD-2')] }, { issues: [issue('SD-3')] }],
  } });
  const store = fakeStore({ ticketSummary: config }, { cursorAt: NOW - 5 * 60000, backfill: { running: true, days: 30, nextPageToken: '', checked: 0, summarised: 0, failed: 0 } });
  const last = await runOnce({ jira, store, summarise: fakeSummarise(), clock: () => NOW });
  assert.match(jira.calls.search[0].jql, /updated >= -8m/);
  assert.deepEqual(jira.calls.writes.map((w) => w.key), ['SD-1', 'SD-2', 'SD-3']);
  assert.equal(last.summarised, 3);
  assert.equal(store.state.cursorAt, NOW - 20 * 60000);
  assert.equal(store.state.backfill.running, false);
  assert.equal(store.state.backfill.summarised, 2);
  assert.equal(store.state.totalSummarised, 3);
});

test('job: a failing ticket is counted and the rest carry on', async () => {
  const NOW = Date.parse('2026-10-20T12:00:00Z');
  const jira = fakeJira({ pages: { 'updated >= -': [{ issues: [issue('SD-1'), issue('SD-2')] }] } });
  const summarise = async (input) => { if (input.title && jira.calls.writes.length === 0 && !summarise.failed) { summarise.failed = true; throw new Error('AI request failed: busy'); } return { summary: 'A clear enough summary.', model: 'm' }; };
  const store = fakeStore({ ticketSummary: config });
  const last = await runOnce({ jira, store, summarise, clock: () => NOW });
  assert.equal(last.failed, 1);
  assert.equal(last.summarised, 1);
  assert.match(last.lastError, /busy/);
});
