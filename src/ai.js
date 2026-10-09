// AI naming and summary for a finished report, using Atlassian-hosted Claude
// (Forge LLMs). Ticket text stays on the Atlassian platform. Only what the
// report already shows is sent: pattern themes, counts and example summaries.
// @forge/llm throws on import outside the Forge runtime, so it is loaded on
// first use; tests pass their own chatFn.
const forgeChat = async (prompt) => (await import('@forge/llm')).chat(prompt);
import { median, patternTrend, topShares } from './analysis.js';
import { hoursOf, outOfHoursShare, peakWindow, windowText } from './timeOfDay.js';

const peakText = (hours) => { const w = peakWindow(hours); return w ? `${windowText(w)} (${w.share}%)` : null; };

// Preferred first. Haiku 4.5 is avoided: Forge retires it on 2026-10-15.
export const MODELS = ['claude-sonnet-5', 'claude-sonnet-4-6'];
const MAX_PATTERNS = 12;
const MAX_EXAMPLES = 8;
const MAX_VALUES = 6;
// Models sometimes send numbers as text ("3", "-1"); accept whole numbers either way.
const wholeNumber = (v) => (typeof v === 'string' && /^-?\d+$/.test(v.trim()) ? Number(v) : v);
const clip = (value, length) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, length);

/** The report reduced to what the model needs, with sizes bounded. */
export function aiInput(report) {
  return {
    customer: clip(report.organization, 120),
    period: `${report.startDate} to ${report.endDate}`,
    tickets: Number(report.currentCount) || 0,
    previousPeriodTickets: Number(report.previousCount) || 0,
    // Ticket totals are exact; pattern counts are scaled from a sample when true.
    patternCountsAreEstimates: Boolean(report.sampled),
    // Median hours to resolve, and share still open, for the period.
    resolution: report.resolution || null,
    // Admin-chosen fields (e.g. base, device type): where tickets come from.
    breakdowns: (report.breakdowns || []).map((b) => ({
      field: clip(b.label, 40),
      top: b.values.slice(0, MAX_VALUES).map((v) => ({ value: clip(v.value, 60), tickets: v.count, previousPeriodTickets: v.previousCount, medianHoursToResolve: v.medianHours ?? null, openShare: v.openShare ?? null })),
    })),
    // Breakdown fields often left empty or set to a placeholder such as "Unknown".
    dataQuality: (report.dataQuality || []).filter((d) => d.share > 0).map((d) => ({
      field: clip(d.label, 40), shareMissingOrPlaceholder: d.share, placeholders: d.placeholders.slice(0, 3).map((p) => clip(p.value, 40)),
    })),
    // When tickets are created (busiest 3 hours, and the share outside 08:00–18:00 Mon–Fri).
    whenCreated: report.timeOfDay ? {
      timeZone: report.timeOfDay.timeZone,
      busiestHours: peakText(hoursOf(report.timeOfDay.grid)),
      outOfHoursShare: outOfHoursShare(report.timeOfDay.grid),
    } : null,
    // Chart buckets (days or weeks) that each pattern's trend follows.
    trendBuckets: (report.timeSeries || []).map((p) => p.date),
    // Broad areas the patterns fall into (all patterns, not just those listed below).
    categories: (Array.isArray(report.categories) ? report.categories : []).slice(0, 12).map((c) => ({
      name: clip(c.title, 60), tickets: Number(c.count) || 0, previousPeriodTickets: Number(c.previousCount) || 0, patterns: Array.isArray(c.members) ? c.members.length : 0,
    })),
    patterns: (report.groups || []).slice(0, MAX_PATTERNS).map((g, index) => ({
      index,
      ruleBasedName: clip(g.theme, 80),
      tickets: Number(g.count) || 0,
      previousPeriodTickets: Number(g.previousCount) || 0,
      exampleSummaries: (g.tickets || []).slice(0, MAX_EXAMPLES).map((t) => clip(t.summary, 200)),
      medianHoursToResolve: median(g.resolvedHours),
      openShare: g.sampleCount ? Math.round(((g.openCount || 0) / g.sampleCount) * 100) : null,
      trend: patternTrend(g, report)?.map((p) => p.count) || null,
      busiestHours: peakText(g.hours),
      where: Object.fromEntries((report.breakdownFields || []).map((f) => [clip(f.label, 40), topShares(g, f.id).map((s) => `${clip(s.value, 60)} ${s.share}%`)]).filter(([, v]) => v.length)),
    })),
  };
}

const TOOL = {
  type: 'function',
  function: {
    name: 'report_insights',
    description: 'Return the customer insight summary.',
    parameters: {
      type: 'object',
      required: ['overview', 'patterns', 'actions'],
      properties: {
        overview: { type: 'string', description: '3-5 plain sentences for an account review: volume change, the biggest problems, what is new or growing.' },
        patterns: {
          type: 'array',
          items: {
            type: 'object',
            required: ['index', 'title', 'summary', 'coherent'],
            properties: {
              index: { type: 'integer', description: 'The pattern index from the input.' },
              title: { type: 'string', description: 'Specific name for the problem, at most 8 words, e.g. "vPOS app freezes on loading screen".' },
              summary: { type: 'string', description: 'One sentence on what customers report, from the examples only.' },
              coherent: { type: 'boolean', description: 'false if the examples describe clearly different problems.' },
            },
          },
        },
        actions: { type: 'array', items: { type: 'string' }, description: 'Up to 3 concrete follow-ups for the service team.' },
      },
    },
  },
};

const SYSTEM = `You are a service desk analyst preparing a customer account review.
You get recurring ticket patterns found by rule-based text matching, with counts and example ticket summaries.
Use only the data given. Do not invent causes, numbers, dates or ticket details. Ticket codes such as crew IDs and airport codes are not problems.
breakdowns and each pattern's "where" show how tickets split across fields the admin chose (for example base or device type). Mention a concentration only when it is clear (for example most of a pattern at one base, or one value growing fast).
medianHoursToResolve and openShare show how long problems take to fix and how many are still open; point out issues that are clearly slower to resolve than the rest.
Each pattern's trend gives tickets per trendBuckets entry; say whether a big issue is new, steady or fading when the trend shows it clearly.
whenCreated and each pattern's busiestHours say when tickets are raised (in whenCreated.timeZone); mention it when a pattern clusters at particular times, such as the start of shifts.
categories, when given, group every pattern into broad areas with totals; lead the overview with the biggest or fastest-growing areas, then the specific patterns behind them.
dataQuality lists fields that are often empty or set to a placeholder; mention it in actions when the share is high (for example above 20%), as it limits what the breakdowns can show.
Ticket totals are exact. When patternCountsAreEstimates is true, pattern counts are scaled up from a sample: describe them approximately ("around 250", "a handful", "several times more") and never quote small previous-period pattern counts as exact figures.
Write in plain British English. Call report_insights once.`;

export function aiMessages(input) {
  return [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: `Customer ticket patterns as JSON:\n${JSON.stringify(input)}` },
  ];
}

function argumentsOf(response, name = TOOL.function.name) {
  const message = response?.choices?.[0]?.message;
  const call = message?.tool_calls?.find((c) => c.function?.name === name);
  if (call) return typeof call.function.arguments === 'string' ? JSON.parse(call.function.arguments) : call.function.arguments;
  // Fallback: a JSON object in the text.
  const text = Array.isArray(message?.content) ? message.content.map((p) => p.text || '').join('') : String(message?.content || '');
  const match = text.match(/\{[\s\S]*\}/);
  return match ? JSON.parse(match[0]) : null;
}

/** Validates and bounds model output; unknown or repeated pattern indexes are dropped. */
export function parseInsights(raw, patternCount) {
  if (!raw || typeof raw !== 'object') throw new Error('The AI response could not be read.');
  const seen = new Set();
  const patterns = (Array.isArray(raw.patterns) ? raw.patterns : [])
    .map((p) => ({ ...p, index: wholeNumber(p?.index) }))
    .filter((p) => Number.isInteger(p.index) && p.index >= 0 && p.index < patternCount && !seen.has(p.index) && seen.add(p.index))
    .map((p) => ({ index: p.index, title: clip(p.title, 80), summary: clip(p.summary, 300), coherent: p.coherent !== false && p.coherent !== 'false' }))
    .filter((p) => p.title);
  return {
    overview: clip(raw.overview, 1200),
    patterns,
    actions: (Array.isArray(raw.actions) ? raw.actions : []).map((a) => clip(a, 240)).filter(Boolean).slice(0, 3),
  };
}

// ---- Merging: which rule-based groups are the same issue ----------------------

const MERGE_GROUPS = 40;
const MERGE_EXAMPLES = 4;

export function mergeInput(report) {
  return (report.groups || []).slice(0, MERGE_GROUPS).map((g, index) => ({
    index,
    name: clip(g.theme, 60),
    tickets: Number(g.count) || 0,
    examples: (g.tickets || []).slice(0, MERGE_EXAMPLES).map((t) => clip(t.summary, 120)),
  }));
}

const MERGE_TOOL = {
  type: 'function',
  function: {
    name: 'merge_groups',
    description: 'Assign every group to exactly one issue and name each issue.',
    parameters: {
      type: 'object',
      required: ['issues'],
      properties: {
        issues: {
          type: 'array',
          description: 'Every input group index appears in exactly one issue. An issue can be a single group.',
          items: {
            type: 'object',
            required: ['title', 'members'],
            properties: {
              title: { type: 'string', description: 'Plain, specific name for the issue, at most 6 words, e.g. "Open a barset" or "vPOS app crashes".' },
              members: { type: 'array', items: { type: 'integer' }, description: 'Indexes of the groups that are this issue.' },
            },
          },
        },
      },
    },
  },
};

const MERGE_SYSTEM = `You tidy up ticket groups found by rule-based text matching for a service desk.
Several groups can be the same customer request or problem written differently: typos ("breset"), plurals, rewording ("open barset" / "opening barset" / "barset needs unlocking"), or extra codes such as airports, crew IDs and dates.
Combine groups when an agent would handle their tickets the same way. Check small groups (2-3 tickets) as well, and add one to a larger issue only when its examples clearly are that same request (for example "Unlock accounts" with "Account locked"). Never use a broad issue as a catch-all: a password reset is not account creation, and removing a flight is not a login problem.
The same thing is often called different names: a brand or model name in one ticket and the generic name in another (for example "bluepad connection" and "pinpad connection" when both are the payment device). sameMeaning lists words this site treats as the same; groups that differ only by those words are the same issue.
If a group's examples are unrelated to each other, or it matches nothing else, keep it as its own issue with its own clear name. Keep genuinely different problems apart even if they share words (for example "vPOS crash" and "vPOS won't charge").
Give every issue a clear name a customer would understand; do not reuse codes or people's names as the name.
Put every index in exactly one issue. Use only the data given. Call merge_groups once.`;

/**
 * Validates merges: indexes in range and used once. One-group issues are
 * renames. Groups the model left out simply keep their rule-based name.
 */
export function parseMerges(raw, groupCount) {
  const used = new Set();
  return (Array.isArray(raw?.issues) ? raw.issues : [])
    .map((issue) => ({
      title: clip(issue?.title, 80),
      members: [...new Set((Array.isArray(issue?.members) ? issue.members : []).map(wholeNumber))]
        .filter((i) => Number.isInteger(i) && i >= 0 && i < groupCount && !used.has(i) && used.add(i)),
    }))
    .filter((issue) => issue.title && issue.members.length > 0);
}

async function callTool(chatFn, models, messages, tool) {
  let lastError;
  for (const model of models) {
    try {
      const response = await chatFn({
        model,
        messages,
        tools: [tool],
        tool_choice: { type: 'function', function: { name: tool.function.name } },
        max_completion_tokens: 2000,
      });
      return { raw: argumentsOf(response, tool.function.name), model };
    } catch (error) {
      lastError = error;
      if (!/model|not allowed|not found|unsupported/i.test(String(error?.message))) break;
    }
  }
  throw new Error(`AI request failed: ${lastError?.message || 'unknown error'}`);
}

/** The site's same-meaning word lists, bounded, for the merge and assign prompts. */
export function sameMeaning(report) {
  return (Array.isArray(report?.synonyms) ? report.synonyms : []).slice(0, 40)
    .map((list) => (Array.isArray(list) ? list : []).slice(0, 20).map((w) => clip(w, 40)).filter(Boolean))
    .filter((list) => list.length >= 2);
}

export async function suggestMerges(report, { chatFn = forgeChat, models = MODELS } = {}) {
  const input = mergeInput(report);
  if (input.length < 2) return { merges: [], model: null };
  const { raw, model } = await callTool(chatFn, models, [
    { role: 'system', content: MERGE_SYSTEM },
    { role: 'user', content: `sameMeaning as JSON:\n${JSON.stringify(sameMeaning(report))}\n\nTicket groups as JSON:\n${JSON.stringify(input)}` },
  ], MERGE_TOOL);
  return { merges: parseMerges(raw, input.length), model };
}

// Step 2 of the AI summary: broad categories over the (merged) patterns, so a
// long list of specific issues reads as a few areas with detail underneath.
const CATEGORY_GROUPS = 80;
export const MAX_CATEGORIES = 10;

export function categoriseInput(report) {
  return (report.groups || []).slice(0, CATEGORY_GROUPS).map((g, index) => ({
    index,
    name: clip(g.theme, 60),
    tickets: Number(g.count) || 0,
    examples: (g.tickets || []).slice(0, 2).map((t) => clip(t.summary, 100)),
  }));
}

const CATEGORY_TOOL = {
  type: 'function',
  function: {
    name: 'categorise_patterns',
    description: 'Put every pattern into exactly one broad category and name each category.',
    parameters: {
      type: 'object',
      required: ['categories'],
      properties: {
        categories: {
          type: 'array',
          description: `Between 2 and ${MAX_CATEGORIES} categories. Every input pattern index appears in exactly one category.`,
          items: {
            type: 'object',
            required: ['title', 'members'],
            properties: {
              title: { type: 'string', description: 'Short name for the area, at most 4 words, e.g. "Payment devices" or "Accounts and access".' },
              members: { type: 'array', items: { type: 'integer' }, description: 'Indexes of the patterns in this category.' },
            },
          },
        },
      },
    },
  },
};

const CATEGORY_SYSTEM = `You organise a service desk's recurring ticket patterns into a few broad categories for a customer account review.
A category is an area a manager would report on: a device or system (for example the point-of-sale app, payment devices, printers), a process (stock and products, accounts and access, data sync) or a type of request.
Each pattern stays as it is; you only choose its category. Group patterns that belong to the same area even when they are different problems, for example "app stuck", "app crash" and "app won't update" all belong under the app.
Aim for 3 to 8 categories, sized so the biggest areas stand out. Use "Other" only for patterns that fit nowhere else, and keep it small.
The same thing is often called different names (a brand name in one ticket, the generic name in another); sameMeaning lists words this site treats as the same.
Name categories plainly, in words a customer would understand; no ticket codes or people's names.
Put every index in exactly one category. Use only the data given. Call categorise_patterns once.`;

export async function suggestCategories(report, { chatFn = forgeChat, models = MODELS } = {}) {
  const input = categoriseInput(report);
  if (input.length < 3) return { categories: [], model: null };
  const { raw, model } = await callTool(chatFn, models, [
    { role: 'system', content: CATEGORY_SYSTEM },
    { role: 'user', content: `sameMeaning as JSON:
${JSON.stringify(sameMeaning(report))}

Patterns as JSON:
${JSON.stringify(input)}` },
  ], CATEGORY_TOOL);
  // Same rules as merges: indexes in range and used once.
  const categories = parseMerges({ issues: raw?.categories }, input.length).slice(0, MAX_CATEGORIES);
  return { categories, model };
}

// ---- Live refresh: sort fresh patterns into the agent's approved issues -------

const ASSIGN_TOOL = {
  type: 'function',
  function: {
    name: 'assign_groups',
    description: 'Assign each ticket group to one of the approved issues, or to none.',
    parameters: {
      type: 'object',
      required: ['assignments'],
      properties: {
        assignments: {
          type: 'array',
          items: {
            type: 'object',
            required: ['index', 'issue'],
            properties: {
              index: { type: 'integer', description: 'Group index.' },
              issue: { type: 'integer', description: 'Approved issue number, or -1 when none fits.' },
            },
          },
        },
      },
    },
  },
};

const ASSIGN_SYSTEM = `You keep a customer's service report up to date. An agent approved a list of issues; new ticket groups have been found by rule-based text matching.
Assign each group to the approved issue it clearly belongs to, allowing for typos, rewording, different names for the same thing (sameMeaning lists words this site treats as the same) and codes such as airports, crew IDs and dates. Use -1 when no approved issue clearly fits; never force a group into an issue.
Use only the data given. Call assign_groups once.`;

/** Validated assignments, one per group index (default -1). */
export function parseAssignments(raw, groupCount, approvedCount) {
  const out = new Array(groupCount).fill(-1);
  const seen = new Set();
  for (const item of Array.isArray(raw?.assignments) ? raw.assignments : []) {
    const index = wholeNumber(item?.index);
    const issue = wholeNumber(item?.issue);
    if (!Number.isInteger(index) || index < 0 || index >= groupCount || seen.has(index)) continue;
    seen.add(index);
    out[index] = Number.isInteger(issue) && issue >= 0 && issue < approvedCount ? issue : -1;
  }
  return out;
}

export async function assignToApproved(report, approved, { chatFn = forgeChat, models = MODELS } = {}) {
  const groups = mergeInput(report);
  if (!groups.length || !approved.length) return { assignments: (report.groups || []).map(() => -1), model: null };
  const { raw, model } = await callTool(chatFn, models, [
    { role: 'system', content: ASSIGN_SYSTEM },
    { role: 'user', content: `sameMeaning as JSON:\n${JSON.stringify(sameMeaning(report))}\n\nApproved issues as JSON:\n${JSON.stringify(approved.map((a, i) => ({ issue: i, title: clip(a.title, 80), summary: clip(a.summary, 200) })))}\n\nTicket groups as JSON:\n${JSON.stringify(groups)}` },
  ], ASSIGN_TOOL);
  const assignments = parseAssignments(raw, groups.length, approved.length);
  // Groups beyond the ones sent stay unassigned.
  return { assignments: [...assignments, ...new Array(Math.max(0, (report.groups || []).length - assignments.length)).fill(-1)], model };
}

// ---- Summary -------------------------------------------------------------------

export async function summarise(report, { chatFn = forgeChat, models = MODELS } = {}) {
  const input = aiInput(report);
  if (!input.patterns.length) throw new Error('There are no patterns to summarise.');
  let lastError;
  for (const model of models) {
    try {
      const response = await chatFn({
        model,
        messages: aiMessages(input),
        tools: [TOOL],
        tool_choice: { type: 'function', function: { name: TOOL.function.name } },
        max_completion_tokens: 2000,
      });
      const raw = argumentsOf(response);
      const parsed = parseInsights(raw, input.patterns.length);
      // finish_reason "length" means the reply was cut off.
      console.log(`aiSummary: finish=${response?.choices?.[0]?.finish_reason}, patterns sent=${input.patterns.length}, returned=${Array.isArray(raw?.patterns) ? raw.patterns.length : 'none'}, kept=${parsed.patterns.length}`);
      return { ...parsed, model };
    } catch (error) {
      lastError = error;
      // Try the next model only when this one is unavailable to the app.
      if (!/model|not allowed|not found|unsupported/i.test(String(error?.message))) break;
    }
  }
  throw new Error(`AI summary failed: ${lastError?.message || 'unknown error'}`);
}
