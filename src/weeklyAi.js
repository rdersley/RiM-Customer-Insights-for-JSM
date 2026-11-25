// Weekly SD report notes written for the agents (src/weekly.js): insights and
// suggested actions from the week's figures and example ticket summaries, by
// Atlassian-hosted Claude (Forge LLMs), plus last week's open actions carried
// forward. Agents review and edit them before publishing; once they save their
// own notes, a rebuild only refreshes the suggestions.
import { callTool, MODELS } from './ai.js';
import { EMPTY_NOTES, NOTE_LIMITS, noteLines } from './weekly.js';

const forgeChat = async (prompt) => (await import('@forge/llm')).chat(prompt);
const clip = (value, length) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, length);
export const MAX_AI_ACTIONS = 5;
export const MAX_PROGRESS = 5; // lines per progress box (completed, in progress, next steps)
const MAX_INSIGHTS = 6;
const EXAMPLE_CATEGORIES = 5;
const EXAMPLES = 6;

/** Last week's actions that aren't done, kept as they were (status, owner, due). */
export function carriedActions(previous) {
  return (previous?.notes?.actions || []).filter((a) => a.action && a.status !== 'Done').map((a) => ({ ...a, source: 'carried' }));
}

/**
 * What the model sees: the week's figures as shown on the report, example
 * ticket summaries for the biggest categories (`examples`: { category: [summary] }),
 * and the actions already open, so it doesn't suggest them again.
 */
export function weeklyAiInput(report, { examples = {}, openActions = [], lastWeek = null } = {}) {
  const activity = (a) => ({
    openEndOfWeek: a.openEnd, openStartOfWeek: a.openStart, created: a.created, resolved: a.resolved,
    resolvedPct: a.resolvedPct, resolvedPctWeekBefore: a.previous.resolvedPct, resolvedPctChangePoints: a.resolvedPctChange,
    createdWeekBefore: a.previous.created, resolvedWeekBefore: a.previous.resolved,
  });
  const w = report.workload;
  return {
    report: report.name,
    week: report.week,
    organizations: report.organizations.map((o) => o.name),
    all: activity(report.activity.all),
    byOrganization: report.activity.byOrg.map((o) => ({ organization: o.organization.name, ...activity(o) })),
    categoryField: report.fields.category,
    categories: (report.categories || []).slice(0, 12).map((c) => ({ name: c.name, created: c.count, share: c.share, weekBefore: c.previous, examples: (examples[c.name] || []).slice(0, EXAMPLES).map((s) => clip(s, 160)) })),
    biggestCategoryBySubcategory: report.subcategories ? { category: report.subcategories.category, subcategories: report.subcategories.rows.slice(0, 10).map((r) => ({ name: r.name, created: r.count, weekBefore: r.previous })) } : null,
    workload: {
      resolved: w.totals.resolved, handlingHours: w.totals.handlingHours, avgHandlingMinutes: w.totals.avgHandlingMinutes, handlingHoursWeekBefore: w.previous.handlingHours,
      statusChangesPerTicket: w.totals.statusChangesPerTicket, reassignmentsPerTicket: w.totals.reassignmentsPerTicket,
      byCategory: w.rows.slice(0, 10).map((r) => ({ name: r.name, resolved: r.resolved, handlingHours: r.handlingHours, avgHandlingMinutes: r.avgHandlingMinutes, shareOfWork: r.share, statusChangesPerTicket: r.statusChangesPerTicket })),
    },
    openActions: openActions.map((a) => clip(a.action, 200)),
    // Last week's register and progress notes (agents' own), for the progress section.
    lastWeek: lastWeek ? {
      actionsDone: lastWeek.done.map((a) => clip(a.action, 200)),
      actionsOpen: lastWeek.open.map((a) => ({ action: clip(a.action, 200), status: a.status || 'Open', owner: clip(a.owner, 80), due: clip(a.due, 40) })),
      inProgress: noteLines(lastWeek.inProgress).slice(0, 8).map((l) => clip(l, 200)),
      nextSteps: noteLines(lastWeek.nextSteps).slice(0, 8).map((l) => clip(l, 200)),
    } : null,
  };
}

const TOOL = {
  type: 'function',
  function: {
    name: 'weekly_insights',
    description: 'Return the insights, suggested actions and progress notes for the weekly service desk report.',
    parameters: {
      type: 'object',
      required: ['insights', 'actions', 'completed', 'inProgress', 'nextSteps'],
      properties: {
        insights: { type: 'array', items: { type: 'string' }, description: `3–${MAX_INSIGHTS} short points, one sentence each, most important first.` },
        completed: { type: 'array', items: { type: 'string' }, description: `Completed this week: up to ${MAX_PROGRESS} lines. Last week's actionsDone, and clear results in the figures (backlog down, % resolved up). Empty when nothing was done.` },
        inProgress: { type: 'array', items: { type: 'string' }, description: `In progress: up to ${MAX_PROGRESS} lines. Open actions being worked on (with their status or due date when given) and last week's next steps not yet done.` },
        nextSteps: { type: 'array', items: { type: 'string' }, description: `Next steps for the coming week: up to ${MAX_PROGRESS} lines, from the open and suggested actions, with owner or due date when given.` },
        actions: {
          type: 'array',
          description: `Up to ${MAX_AI_ACTIONS} new follow-ups the figures clearly call for. Leave out anything already in openActions.`,
          items: {
            type: 'object',
            required: ['action'],
            properties: {
              action: { type: 'string', description: 'What to do, specific and short, e.g. "Review vPOS login failures at STN with the device team".' },
              owner: { type: 'string', description: '"Service desk" or the customer\'s name when it is clearly theirs to do; empty when unclear.' },
            },
          },
        },
      },
    },
  },
};

const SYSTEM = `You are a service desk analyst writing the weekly report for a customer's management.
You get last week's figures (Monday to Sunday) with the week before for comparison: the open backlog, tickets created and resolved, % resolved (resolved ÷ (open at the start + created)), tickets by category with example ticket summaries, the biggest category by subcategory, and the workload to resolve tickets (handling time and steps per ticket, by category).
Insights: say what changed and why it matters: backlog growing or shrinking, % resolved up or down, categories or subcategories rising or falling sharply, categories that take much more work per ticket than others, and any organisation that differs from the rest. Quote the figures given; round sensibly. Use the example summaries only to name what a category is about.
Actions: suggest concrete follow-ups only where the figures point to a problem (a rising category, a growing backlog, a category with high handling time or many steps). Do not repeat openActions. No actions is fine.
Progress (completed, inProgress, nextSteps): short customer-facing lines, one item each. Completed: only lastWeek.actionsDone and results the figures show; never claim work that isn't in the data. In progress: lastWeek.actionsOpen and lastWeek.nextSteps not shown as done. Next steps: what the open and newly suggested actions mean for the coming week. No lastWeek: base progress on the figures and your suggested actions only; leave completed empty.
Use only the data given. Do not invent causes, dates, people or ticket details. Ticket codes such as crew IDs and airport codes are not problems.
Write in plain British English. Call weekly_insights once.`;

export function parseWeeklyNotes(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('The AI response could not be read.');
  const insights = (Array.isArray(raw.insights) ? raw.insights : []).map((s) => clip(s, 400)).filter(Boolean).slice(0, MAX_INSIGHTS);
  const actions = (Array.isArray(raw.actions) ? raw.actions : [])
    .map((a) => ({ action: clip(a?.action ?? a, NOTE_LIMITS.action), owner: clip(a?.owner, NOTE_LIMITS.owner), due: '', status: 'Open', source: 'ai' }))
    .filter((a) => a.action)
    .slice(0, MAX_AI_ACTIONS);
  const lines = (list) => (Array.isArray(list) ? list : []).map((s) => clip(s, 300)).filter(Boolean).slice(0, MAX_PROGRESS).join('\n');
  return { insights, actions, completed: lines(raw.completed), inProgress: lines(raw.inProgress), nextSteps: lines(raw.nextSteps) };
}

/**
 * Suggested notes for a week: AI insights and actions, after last week's open
 * actions. AI failures leave the carried actions and an error, never fail the build.
 */
export async function suggestWeeklyNotes(report, { examples = {}, previous = null, chatFn = forgeChat, models = MODELS, at = new Date().toISOString() } = {}) {
  const carried = carriedActions(previous);
  const prevNotes = previous?.notes || {};
  const lastWeek = previous ? { done: (prevNotes.actions || []).filter((a) => a.action && a.status === 'Done'), open: carried, inProgress: prevNotes.inProgress, nextSteps: prevNotes.nextSteps } : null;
  try {
    const { raw, model } = await callTool(chatFn, models, [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Weekly figures as JSON:\n${JSON.stringify(weeklyAiInput(report, { examples, openActions: carried, lastWeek }))}` },
    ], TOOL);
    const parsed = parseWeeklyNotes(raw);
    const known = new Set(carried.map((a) => a.action.toLowerCase()));
    const fresh = parsed.actions.filter((a) => !known.has(a.action.toLowerCase()));
    return { insights: parsed.insights.join('\n'), actions: [...carried, ...fresh].slice(0, NOTE_LIMITS.actions), completed: parsed.completed, inProgress: parsed.inProgress, nextSteps: parsed.nextSteps, at, model, error: null };
  } catch (error) {
    console.log(`weekly: AI notes failed: ${error.message}`);
    return { insights: '', actions: carried, completed: '', inProgress: '', nextSteps: '', at, model: null, error: String(error.message || error).slice(0, 300) };
  }
}

/**
 * The notes a build saves: the suggestions while agents haven't saved their
 * own (`notesSavedAt`), otherwise the agents' notes unchanged.
 */
export function notesAfterBuild(existing, suggested) {
  if (existing?.notesSavedAt) return existing.notes;
  const progress = (key) => suggested[key] || existing?.notes?.[key] || '';
  return { ...EMPTY_NOTES, ...existing?.notes, insights: suggested.insights, actions: suggested.actions, completed: progress('completed'), inProgress: progress('inProgress'), nextSteps: progress('nextSteps') };
}

// ---- Top 10 issue trends per focus category (Excel "Trend analysis") -------------
// The model groups the week's tickets in a category by the problem reported and
// says which tickets are in each group; the counts are made here from those keys.

export const MAX_TRENDS = 10;
const TREND_TICKETS = 300; // per category; newest first
const TREND_TEXT = 350;

const TREND_TOOL = {
  type: 'function',
  function: {
    name: 'issue_trends',
    description: 'Return the issue trends for the tickets given.',
    parameters: {
      type: 'object',
      required: ['trends'],
      properties: {
        trends: {
          type: 'array',
          description: `Up to ${MAX_TRENDS + 2} trends, biggest first. Every ticket in at most one trend.`,
          items: {
            type: 'object',
            required: ['title', 'tickets'],
            properties: {
              title: { type: 'string', description: 'The problem, short and specific, e.g. "PIN pad pairing failures, repeated disconnections or QR-code pairing problems".' },
              devices: { type: 'string', description: 'Which devices are affected, from the tickets, e.g. "Mainly PIN pads; some vPOS phones". Empty when not about devices.' },
              tickets: { type: 'array', items: { type: 'integer' }, description: 'The n of each ticket in this trend.' },
              example: { type: 'integer', description: 'The n of one typical ticket from tickets.' },
              exampleText: { type: 'string', description: 'One or two sentences on that ticket: what happened and what support did. No names, emails or crew codes.' },
            },
          },
        },
      },
    },
  },
};

const TREND_SYSTEM = `You are a service desk analyst. You get last week's tickets in one category (a number n and an overview of each).
Group them into issue trends by the problem the customer reported, so a manager can see the top issues. Put each ticket in the trend that fits it best, and at most one. Use clear, specific titles; merge near-duplicates; leave out tickets that fit no trend.
For each trend give the devices affected when the tickets say, the n of its tickets, and one example ticket with one or two sentences on what happened and what support did.
Use only the text given. No people's names, emails, phone numbers or crew codes. Plain British English. Call issue_trends once.`;

/** Trends from the model's answer: ticket numbers (1-based n) turned into keys, each counted once, biggest first, ranked. */
export function parseTrends(raw, tickets) {
  const keyOf = (n) => tickets[Number(n) - 1]?.key || '';
  const taken = new Set();
  return (Array.isArray(raw?.trends) ? raw.trends : []).map((t) => {
    const keys = (Array.isArray(t?.tickets) ? t.tickets : []).map(keyOf).filter((k) => k && !taken.has(k) && taken.add(k));
    const exampleKey = keys.includes(keyOf(t?.example)) ? keyOf(t.example) : keys[0] || '';
    return { title: clip(t?.title, 200), devices: clip(t?.devices, 160), count: keys.length, keys, exampleKey, example: clip(t?.exampleText, 500) };
  }).filter((t) => t.title && t.count)
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_TRENDS)
    .map((t, i) => ({ rank: i + 1, ...t }));
}

/**
 * Top issue trends for each focus category. `groups`: [{ name, label, tickets:
 * [{ key, text }] }]. Failures are recorded per category, never fail the build.
 */
export async function suggestTrends(groups, { chatFn = forgeChat, models = MODELS, at = new Date().toISOString() } = {}) {
  const out = [];
  for (const g of groups) {
    const tickets = g.tickets.slice(0, TREND_TICKETS).map((t) => ({ key: t.key, text: clip(t.text, TREND_TEXT) })).filter((t) => t.key && t.text);
    if (!tickets.length) { out.push({ name: g.name, label: g.label, tickets: 0, trends: [], model: null, error: null }); continue; }
    try {
      const { raw, model } = await callTool(chatFn, models, [
        { role: 'system', content: TREND_SYSTEM },
        { role: 'user', content: `Category: ${clip(g.name, 80)}\nTickets as JSON:\n${JSON.stringify(tickets.map((t, i) => ({ n: i + 1, text: t.text })))}` },
      ], TREND_TOOL, { maxTokens: 6000 });
      out.push({ name: g.name, label: g.label, tickets: g.tickets.length, sent: tickets.length, trends: parseTrends(raw, tickets), model, error: null });
    } catch (error) {
      console.log(`weekly: AI trends failed for ${g.name}: ${error.message}`);
      out.push({ name: g.name, label: g.label, tickets: g.tickets.length, trends: [], model: null, error: String(error.message || error).slice(0, 300) });
    }
  }
  return { at, groups: out };
}
