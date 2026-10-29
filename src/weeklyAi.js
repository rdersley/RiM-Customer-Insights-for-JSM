// Weekly SD report notes written for the agents (src/weekly.js): insights and
// suggested actions from the week's figures and example ticket summaries, by
// Atlassian-hosted Claude (Forge LLMs), plus last week's open actions carried
// forward. Agents review and edit them before publishing; once they save their
// own notes, a rebuild only refreshes the suggestions.
import { callTool, MODELS } from './ai.js';
import { EMPTY_NOTES, NOTE_LIMITS } from './weekly.js';

const forgeChat = async (prompt) => (await import('@forge/llm')).chat(prompt);
const clip = (value, length) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, length);
export const MAX_AI_ACTIONS = 5;
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
export function weeklyAiInput(report, { examples = {}, openActions = [] } = {}) {
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
  };
}

const TOOL = {
  type: 'function',
  function: {
    name: 'weekly_insights',
    description: 'Return the insights and suggested actions for the weekly service desk report.',
    parameters: {
      type: 'object',
      required: ['insights', 'actions'],
      properties: {
        insights: { type: 'array', items: { type: 'string' }, description: `3–${MAX_INSIGHTS} short points, one sentence each, most important first.` },
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
Use only the data given. Do not invent causes, dates, people or ticket details. Ticket codes such as crew IDs and airport codes are not problems.
Write in plain British English. Call weekly_insights once.`;

export function parseWeeklyNotes(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('The AI response could not be read.');
  const insights = (Array.isArray(raw.insights) ? raw.insights : []).map((s) => clip(s, 400)).filter(Boolean).slice(0, MAX_INSIGHTS);
  const actions = (Array.isArray(raw.actions) ? raw.actions : [])
    .map((a) => ({ action: clip(a?.action ?? a, NOTE_LIMITS.action), owner: clip(a?.owner, NOTE_LIMITS.owner), due: '', status: 'Open', source: 'ai' }))
    .filter((a) => a.action)
    .slice(0, MAX_AI_ACTIONS);
  return { insights, actions };
}

/**
 * Suggested notes for a week: AI insights and actions, after last week's open
 * actions. AI failures leave the carried actions and an error, never fail the build.
 */
export async function suggestWeeklyNotes(report, { examples = {}, previous = null, chatFn = forgeChat, models = MODELS, at = new Date().toISOString() } = {}) {
  const carried = carriedActions(previous);
  try {
    const { raw, model } = await callTool(chatFn, models, [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Weekly figures as JSON:\n${JSON.stringify(weeklyAiInput(report, { examples, openActions: carried }))}` },
    ], TOOL);
    const parsed = parseWeeklyNotes(raw);
    const known = new Set(carried.map((a) => a.action.toLowerCase()));
    const fresh = parsed.actions.filter((a) => !known.has(a.action.toLowerCase()));
    return { insights: parsed.insights.join('\n'), actions: [...carried, ...fresh].slice(0, NOTE_LIMITS.actions), at, model, error: null };
  } catch (error) {
    console.log(`weekly: AI notes failed: ${error.message}`);
    return { insights: '', actions: carried, at, model: null, error: String(error.message || error).slice(0, 300) };
  }
}

/**
 * The notes a build saves: the suggestions while agents haven't saved their
 * own (`notesSavedAt`), otherwise the agents' notes unchanged.
 */
export function notesAfterBuild(existing, suggested) {
  if (existing?.notesSavedAt) return existing.notes;
  return { ...EMPTY_NOTES, ...existing?.notes, insights: suggested.insights, actions: suggested.actions };
}
