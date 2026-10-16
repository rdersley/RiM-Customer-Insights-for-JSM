import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { emailList, emailMessage, isEmailDue, lastSlot, periodFor, sanitizeEmailConfig, sanitizeSchedule } from '../src/email.js';

const orgs = [{ id: '188', name: 'Ryanair Crew' }, { id: '189', name: 'Ryanair Hardware' }];
const base = { name: 'Ryanair weekly', organizations: [{ id: '188' }], internal: 'lead@retailinmotion.com', customers: 'ops@ryanair.com, bad-address', frequency: 'weekly', weekday: 1, hour: 8, timeZone: 'Europe/Dublin' };

test('recipients, connection and schedules are validated', () => {
  assert.deepEqual(emailList('A@x.com, a@x.com; b@y.ie\nnot-an-email'), ['a@x.com', 'b@y.ie']);
  assert.deepEqual(sanitizeEmailConfig({ tenantId: 'retailinmotion.onmicrosoft.com', clientId: '0b5c9a4e-1111-2222-3333-444455556666', sender: 'Reports@RetailInMotion.com' }),
    { tenantId: 'retailinmotion.onmicrosoft.com', clientId: '0b5c9a4e-1111-2222-3333-444455556666', sender: 'reports@retailinmotion.com' });
  assert.equal(sanitizeEmailConfig({ clientId: 'nope' }).clientId, '');
  const s = sanitizeSchedule(base, orgs);
  assert.deepEqual(s.organizations, [orgs[0]]);
  assert.deepEqual(s.customers, ['ops@ryanair.com']);
  assert.equal(s.period, 'last-week');
  assert.match(s.id, /^s-/);
  assert.throws(() => sanitizeSchedule({ ...base, organizations: [{ id: '999' }] }, orgs), /organisation/);
  assert.throws(() => sanitizeSchedule({ ...base, internal: '', customers: '' }, orgs), /recipient/);
  assert.equal(sanitizeSchedule({ ...base, frequency: 'monthly', period: undefined }, orgs).period, 'last-month');
});

test('weekly and monthly slots in the schedule\'s time zone; due once per slot', () => {
  const weekly = sanitizeSchedule(base, orgs);
  // Monday 12 Oct 2026, 07:30 UTC = 08:30 in Dublin (IST): this Monday's 08:00 slot has passed.
  assert.equal(lastSlot(weekly, new Date('2026-10-12T07:30:00Z')), '2026-10-12 08');
  // 06:30 UTC = 07:30 Dublin: not yet, so last week's slot.
  assert.equal(lastSlot(weekly, new Date('2026-10-12T06:30:00Z')), '2026-10-05 08');
  assert.equal(isEmailDue(weekly, {}, new Date('2026-10-12T07:30:00Z')), true);
  assert.equal(isEmailDue(weekly, { lastSlot: '2026-10-12 08' }, new Date('2026-10-12T09:30:00Z')), false);
  assert.equal(isEmailDue({ ...weekly, enabled: false }, {}, new Date('2026-10-12T07:30:00Z')), false);
  // Queued this slot less than an hour ago: not again.
  assert.equal(isEmailDue(weekly, { queuedSlot: '2026-10-12 08', queuedAt: '2026-10-12T07:10:00Z' }, new Date('2026-10-12T07:30:00Z')), false);
  const monthly = sanitizeSchedule({ ...base, frequency: 'monthly', dayOfMonth: 1, hour: 9 }, orgs);
  assert.equal(lastSlot(monthly, new Date('2026-10-01T09:30:00Z')), '2026-10-01 09');
  assert.equal(lastSlot(monthly, new Date('2026-10-01T07:00:00Z')), '2026-09-01 09');
  assert.equal(lastSlot(monthly, new Date('2026-01-01T05:00:00Z')), '2025-12-01 09');
  assert.equal(lastSlot({ ...weekly, frequency: 'manual' }), null);
  // Period: last week (Mon-Sun) and last month in Dublin.
  assert.deepEqual(periodFor(weekly, new Date('2026-10-12T07:30:00Z')), { from: '2026-10-05', to: '2026-10-11' });
  assert.deepEqual(periodFor({ ...monthly, period: 'last-month' }, new Date('2026-10-01T09:30:00Z')), { from: '2026-09-01', to: '2026-09-30' });
});

test('the message: customers in To, staff in Cc, subject filled in, text escaped, PDF attached', () => {
  const s = sanitizeSchedule({ ...base, message: 'Hi <team>,\nhere it is.' }, orgs);
  const m = emailMessage(s, { from: '2026-10-05', to: '2026-10-11', title: 'Ryanair Crew', fileName: 'r.pdf', pdfBase64: 'JVBERi0x' }).message;
  assert.deepEqual(m.toRecipients, [{ emailAddress: { address: 'ops@ryanair.com' } }]);
  assert.deepEqual(m.ccRecipients, [{ emailAddress: { address: 'lead@retailinmotion.com' } }]);
  assert.equal(m.subject, 'Ryanair Crew service report: 2026-10-05 to 2026-10-11');
  assert.match(m.body.content, /Hi &lt;team&gt;,<br>here it is\./);
  assert.deepEqual(m.attachments[0], { '@odata.type': '#microsoft.graph.fileAttachment', name: 'r.pdf', contentType: 'application/pdf', contentBytes: 'JVBERi0x' });
  const internalOnly = emailMessage({ ...s, customers: [] }, { from: 'a', to: 'b', title: 'T', fileName: 'f', pdfBase64: '' }).message;
  assert.deepEqual([internalOnly.toRecipients.length, internalOnly.ccRecipients.length], [1, 0]);
});

// ---- A whole send, with Jira, storage and Microsoft mocked -----------------------------
const store = new Map();
const secrets = new Map([['email-client-secret', 's3cret']]);
const sent = [];
const issues = Array.from({ length: 6 }, (_, i) => ({ id: String(i), key: `SD-${i}`, fields: { summary: 'RYR - vPOS sync failing', description: '', created: `2026-10-0${6 + (i % 3)}T09:00:00Z`, status: { name: 'Open' } } }));
mock.module('@forge/kvs', {
  namedExports: {
    kvs: {
      get: async (k) => store.get(k),
      set: async (k, v) => { store.set(k, v); },
      delete: async (k) => { store.delete(k); },
      getSecret: async (k) => secrets.get(k),
      setSecret: async (k, v) => { secrets.set(k, v); },
      deleteSecret: async (k) => { secrets.delete(k); },
    },
    WhereConditions: {},
  },
});
const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
mock.module('@forge/api', {
  namedExports: {
    route: (strings, ...values) => strings.reduce((out, s, i) => out + s + (i < values.length ? encodeURIComponent(values[i]) : ''), ''),
    asUser: () => ({ requestJira: async () => json({}) }),
    asApp: () => ({
      requestJira: async (path, init = {}) => {
        if (path === '/rest/api/3/search/approximate-count') return json({ count: JSON.parse(init.body).jql.includes('"2026-10-05"') ? 6 : 2 });
        if (path === '/rest/api/3/search/jql') return json({ issues: JSON.parse(init.body).jql.includes('"2026-10-05"') ? issues : [] });
        return json({});
      },
    }),
    fetch: async (url, init) => {
      if (url.startsWith('https://login.microsoftonline.com/')) return json({ access_token: 'token-1' });
      if (url.startsWith('https://graph.microsoft.com/')) { sent.push({ url, auth: init.headers.Authorization, body: JSON.parse(init.body) }); return new Response('', { status: 202 }); }
      return json({}, 404);
    },
  },
});

test('a scheduled send builds the PDF and mails it through Microsoft 365', async () => {
  const schedule = sanitizeSchedule(base, orgs);
  store.set('email-schedules', [schedule]);
  store.set('email-config', { tenantId: 'retailinmotion.onmicrosoft.com', clientId: '0b5c9a4e-1111-2222-3333-444455556666', sender: 'reports@retailinmotion.com' });
  const { sendSchedule } = await import('../src/emailJobs.js');
  const result = await sendSchedule(schedule.id, { slot: '2026-10-12 08', now: new Date('2026-10-12T07:30:00Z') });
  assert.deepEqual(result, { sent: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, 'https://graph.microsoft.com/v1.0/users/reports%40retailinmotion.com/sendMail');
  assert.equal(sent[0].auth, 'Bearer token-1');
  const { message } = sent[0].body;
  assert.deepEqual(message.toRecipients.map((r) => r.emailAddress.address), ['ops@ryanair.com']);
  assert.ok(message.attachments[0].contentBytes.startsWith('JVBER')); // %PDF
  assert.match(message.attachments[0].name, /^customer-insights-ryanair-crew-2026-10-05-2026-10-11\.pdf$/);
  assert.equal(store.get(`email-state:${schedule.id}`).lastSlot, '2026-10-12 08');
  assert.equal(store.get('email-log')[0].ok, true);
  // A test goes to one address only.
  await sendSchedule(schedule.id, { reason: 'test', overrideTo: 'me@retailinmotion.com', now: new Date('2026-10-12T07:30:00Z') });
  assert.deepEqual(sent[1].body.message.toRecipients.map((r) => r.emailAddress.address), ['me@retailinmotion.com']);
  assert.deepEqual(sent[1].body.message.ccRecipients, []);
  // Only internal-only sends (like this test) carry the health score, so the PDF is larger.
  assert.ok(sent[1].body.message.attachments[0].contentBytes.length > sent[0].body.message.attachments[0].contentBytes.length);
});
