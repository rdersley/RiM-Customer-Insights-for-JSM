// Keeping AI ticket summaries cheap: Haiku first, quoted email history and
// footers left out, and the characters sent counted for the run log.
import test from 'node:test';
import assert from 'node:assert/strict';
import { summaryInput, withoutQuoted } from '../src/ticketSummary.js';
import { SUMMARY_MODELS, summariseTicket } from '../src/ticketSummaryAi.js';

test('summaries use Haiku first, Sonnet as the fallback', async () => {
  assert.equal(SUMMARY_MODELS[0], 'claude-haiku-4-5-20251001');
  assert.ok(SUMMARY_MODELS.slice(1).some((m) => /sonnet/.test(m)));
  const seen = [];
  const chatFn = async (p) => { seen.push(p.model); return { choices: [{ message: { tool_calls: [{ function: { name: 'ticket_summary', arguments: JSON.stringify({ summary: 'The card reader at STN is offline; support is replacing it.' }) } }] } }] }; };
  const { model } = await summariseTicket({ title: 'x', description: 'y', comments: [] }, { chatFn });
  assert.equal(model, 'claude-haiku-4-5-20251001');
  assert.deepEqual(seen, ['claude-haiku-4-5-20251001']);
});

test('quoted earlier emails, mobile footers and disclaimers are left out', () => {
  const reply = 'Still not working after the restart.\nCan you send a new one?\n\nOn Mon, 3 Nov 2026 at 09:12, Support <support@example.com> wrote:\n> Please restart the device\n> Thanks';
  assert.equal(withoutQuoted(reply), 'Still not working after the restart.\nCan you send a new one?');
  assert.equal(withoutQuoted('Done, thanks\nSent from my iPhone'), 'Done, thanks');
  assert.equal(withoutQuoted('Replaced.\n-----Original Message-----\nFrom: x\nold text'), 'Replaced.');
  assert.equal(withoutQuoted('OK\nThis email and any attachments are confidential...'), 'OK');
  assert.equal(withoutQuoted('> only quoted text'), '> only quoted text'); // nothing left: kept whole
});

test('a forwarded email in the description is kept whole', () => {
  const forwarded = 'Please see below.\nFrom: crew member\nSent: Monday\nThe vPOS at BGY will not log in after the update and shows error 504 on every attempt since this morning.';
  const input = summaryInput({ fields: { summary: 'FW: vPOS', description: forwarded } }, [
    { body: 'We have replaced it.\nOn Tue, 4 Nov 2026, Crew wrote:\n> it is broken\n> really broken', created: '2026-11-04' },
  ]);
  assert.match(input.description, /error 504/);
  assert.equal(input.comments[0].text, 'We have replaced it.');
});
