// The AI call for ticket summaries (src/ticketSummary.js), Atlassian-hosted
// Claude through Forge LLMs like the report summary in ai.js.
import { MODELS, callTool } from './ai.js';

const forgeChat = async (prompt) => (await import('@forge/llm')).chat(prompt);
const MAX_SUMMARY = 700;
const clip = (value, length) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, length);

const SYSTEM = `You write the summary of one support ticket for the customer's own report. The customer reads it in an Excel export next to the ticket's title, which is often an unclear email subject line.

Write 2 to 4 short, plain sentences in British English:
1. What the problem or request is, in specific terms (device, system, location or reference if given).
2. What has been done or said so far.
3. Where it stands now, or what is needed next and from whom (support or the customer).

Rules:
- Use only the ticket text given. Never guess causes, dates or outcomes that aren't stated.
- Leave out greetings, signatures, email footers, legal disclaimers and quoted earlier emails.
- No names of individuals, email addresses or phone numbers. Say "the customer" or "support".
- If the ticket has very little detail, say what it is about in one sentence and that no further detail was given.
- Under 600 characters.`;

const TOOL = {
  type: 'function',
  function: {
    name: 'ticket_summary',
    description: 'Return the ticket summary.',
    parameters: { type: 'object', required: ['summary'], properties: { summary: { type: 'string', description: '2-4 plain sentences, under 600 characters.' } } },
  },
};

export function parseSummary(raw) {
  const text = clip(raw?.summary, MAX_SUMMARY);
  return text.length >= 10 ? text : '';
}

export async function summariseTicket(input, { chatFn = forgeChat, models = MODELS } = {}) {
  const { raw, model } = await callTool(chatFn, models, [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Ticket as JSON:\n${JSON.stringify(input)}` },
  ], TOOL);
  const summary = parseSummary(raw);
  if (!summary) throw new Error('The AI returned no summary.');
  return { summary, model };
}

