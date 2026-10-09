import test from 'node:test';
import assert from 'node:assert/strict';
import { aiInput, assignToApproved, MAX_CATEGORIES, parseAssignments, parseInsights, parseMerges, suggestCategories, suggestMerges, summarise } from '../src/ai.js';
import { applyMerges, categoriesOf } from '../src/analysis.js';

const report = {
  organization: 'Ryanair Crew', startDate: '2026-06-01', endDate: '2026-08-31', currentCount: 6793, previousCount: 4484,
  groups: Array.from({ length: 15 }, (_, i) => ({
    theme: `Theme ${i}`, count: 100 - i, previousCount: 10,
    tickets: Array.from({ length: 10 }, (_, j) => ({ summary: `RYR - CODE${j} - STN - problem ${i} ${'x'.repeat(300)}` })),
  })),
};

test('AI input is bounded: 12 patterns, 8 examples, clipped text', () => {
  const input = aiInput(report);
  assert.equal(input.patterns.length, 12);
  assert.equal(input.patterns[0].exampleSummaries.length, 8);
  assert.equal(input.patterns[0].exampleSummaries[0].length <= 200, true);
  assert.equal(input.tickets, 6793);
  assert.equal(input.patternCountsAreEstimates, false);
  assert.equal(aiInput({ ...report, sampled: true }).patternCountsAreEstimates, true);
});

test('AI input includes field breakdowns and where each pattern happens', () => {
  const withFields = {
    ...report,
    breakdownFields: [{ id: 'base', label: 'Base' }],
    breakdowns: [{ id: 'base', label: 'Base', values: [{ value: 'STN', count: 40, previousCount: 10 }, { value: 'DUB', count: 5, previousCount: 6 }] }],
    groups: [{ ...report.groups[0], sampleCount: 4, dimCounts: { base: { STN: 3, DUB: 1 } } }],
  };
  const input = aiInput(withFields);
  assert.deepEqual(input.breakdowns, [{ field: 'Base', top: [
    { value: 'STN', tickets: 40, previousPeriodTickets: 10, medianHoursToResolve: null, openShare: null },
    { value: 'DUB', tickets: 5, previousPeriodTickets: 6, medianHoursToResolve: null, openShare: null },
  ] }]);
  assert.deepEqual(input.patterns[0].where, { Base: ['STN 75%', 'DUB 25%'] });
  assert.deepEqual(aiInput(report).patterns[0].where, {});
});

test('model output is validated: bad indexes and duplicates dropped, text bounded', () => {
  const parsed = parseInsights({
    overview: 'o'.repeat(5000),
    patterns: [
      { index: 0, title: 'vPOS app freezes', summary: 's', coherent: true },
      { index: 0, title: 'duplicate', summary: 's', coherent: true },
      { index: 99, title: 'out of range', summary: 's', coherent: true },
      { index: 1, title: '', summary: 'no title', coherent: true },
      { index: 2, title: 'Mixed bag', summary: 's', coherent: false },
    ],
    actions: ['a', 'b', 'c', 'd'],
  }, 12);
  assert.equal(parsed.overview.length, 1200);
  assert.deepEqual(parsed.patterns.map((p) => p.index), [0, 2]);
  assert.equal(parsed.patterns[1].coherent, false);
  assert.equal(parsed.actions.length, 3);
  assert.throws(() => parseInsights(null, 3));
});

test('summarise forces the tool, reads its arguments and falls back to the next model', async () => {
  const calls = [];
  const chatFn = async (prompt) => {
    calls.push(prompt);
    if (prompt.model === 'unavailable') throw new Error('Forge LLMs model not allowed');
    return { choices: [{ message: { role: 'assistant', content: '', tool_calls: [{ function: { name: 'report_insights', arguments: { overview: 'Volume up 51%.', patterns: [{ index: 0, title: 'vPOS freezes', summary: 's', coherent: true }], actions: ['Check release 3.2'] } } }] } }] };
  };
  const result = await summarise(report, { chatFn, models: ['unavailable', 'claude-sonnet-5'] });
  assert.equal(result.model, 'claude-sonnet-5');
  assert.equal(result.patterns[0].title, 'vPOS freezes');
  assert.equal(calls[1].tool_choice.function.name, 'report_insights');
  assert.equal('temperature' in calls[1], false);
});

// The barset groups from the Ryanair Crew screenshot.
const barsetGroups = [
  ['Open barset', 22, 11], ['Open barset', 7, 9], ['Crl bond open flight', 4, 3], ['Needs unlock barset vno', 3, 2],
  ['Ryanair vpack log ins', 3, 2], ['Open barsets p01', 3, 0], ['Opening breset', 3, 0], ['Broken tablets', 2, 0],
].map(([theme, count, previousCount], i) => ({
  id: `g${i}`, theme, count, previousCount, sampleCount: count, estimated: false,
  tickets: [{ key: `SD-${i}`, summary: `RYR - ${theme}`, created: `2026-08-${String(10 + i).padStart(2, '0')}T10:00:00Z`, status: 'Open', url: '#' }],
}));

test('merges are validated: in range and each group once; single groups are renames', () => {
  const merges = parseMerges({ issues: [
    { title: 'Open a barset', members: [0, 1, 5, 6, 3, 99] },
    { title: 'Duplicate use', members: [0, 7] },
    { title: 'vPack login problems', members: [4] },
    { title: '', members: [2] },
    { title: 'Nothing valid', members: [0, 99] },
  ] }, 8);
  assert.deepEqual(merges, [
    { title: 'Open a barset', members: [0, 1, 5, 6, 3] },
    { title: 'Duplicate use', members: [7] },
    { title: 'vPack login problems', members: [4] },
  ]);
});

test('a one-group issue renames it and keeps the rule-based name', () => {
  const merged = applyMerges(barsetGroups, [{ title: 'vPack login problems', members: [4] }]);
  const renamed = merged.find((g) => g.theme === 'vPack login problems');
  assert.equal(renamed.count, 3);
  assert.deepEqual(renamed.ruleNames, ['Ryanair vpack log ins']);
  assert.equal('mergedFrom' in renamed, false);
  assert.equal(merged.find((g) => g.theme === 'Broken tablets').ruleNames, undefined);
});

test('applying merges adds up counts and keeps other groups as they are', () => {
  const merged = applyMerges(barsetGroups, [{ title: 'Open a barset', members: [0, 1, 3, 5, 6] }]);
  assert.equal(merged[0].theme, 'Open a barset');
  assert.equal(merged[0].count, 22 + 7 + 3 + 3 + 3);
  assert.equal(merged[0].previousCount, 11 + 9 + 2);
  assert.equal(merged[0].change, 38 - 22);
  assert.deepEqual(merged[0].mergedFrom, ['Open barset', 'Open barset', 'Needs unlock barset vno', 'Open barsets p01', 'Opening breset']);
  assert.equal(merged.length, 4);
  assert.equal(merged.find((g) => g.theme === 'Broken tablets').count, 2);
  assert.equal(merged.reduce((sum, g) => sum + g.count, 0), barsetGroups.reduce((sum, g) => sum + g.count, 0));
});

test('suggestMerges forces the merge tool and sends bounded examples', async () => {
  let prompt;
  const chatFn = async (p) => {
    prompt = p;
    return { choices: [{ message: { content: '', tool_calls: [{ function: { name: 'merge_groups', arguments: { issues: [{ title: 'Open a barset', members: [0, 1, 6] }] } } }] } }] };
  };
  const result = await suggestMerges({ groups: barsetGroups }, { chatFn, models: ['claude-sonnet-5'] });
  assert.equal(prompt.tool_choice.function.name, 'merge_groups');
  assert.deepEqual(result.merges, [{ title: 'Open a barset', members: [0, 1, 6] }]);
  assert.equal(JSON.parse(prompt.messages[1].content.split('Ticket groups as JSON:\n')[1]).length, 8);
});

test('merge and assign prompts carry the site\'s same-meaning words', async () => {
  const prompts = [];
  const chatFn = async (p) => { prompts.push(p); return { choices: [{ message: { tool_calls: [{ function: { name: p.tool_choice.function.name, arguments: { issues: [], assignments: [] } } }] } }] }; };
  const synonyms = [['pinpad', 'bluepad', 'pin pad'], ['only one']];
  await suggestMerges({ groups: barsetGroups, synonyms }, { chatFn, models: ['claude-sonnet-5'] });
  await assignToApproved({ groups: barsetGroups, synonyms }, [{ title: 'Pinpad connection' }], { chatFn, models: ['claude-sonnet-5'] });
  for (const p of prompts) {
    assert.deepEqual(JSON.parse(p.messages[1].content.split('\n')[1]), [['pinpad', 'bluepad', 'pin pad']]);
    assert.match(p.messages[0].content, /sameMeaning/);
  }
});

test('pattern numbers sent as text are accepted', () => {
  const parsed = parseInsights({ overview: 'o', actions: [], patterns: [
    { index: '0', title: 'vPOS freezes', summary: 's', coherent: true },
    { index: ' 2 ', title: 'Mixed one', summary: 's', coherent: 'false' },
    { index: '1.5', title: 'Not whole', summary: 's' },
    { index: 'x', title: 'Not a number', summary: 's' },
  ] }, 5);
  assert.deepEqual(parsed.patterns.map((p) => [p.index, p.coherent]), [[0, true], [2, false]]);
  assert.deepEqual(parseMerges({ issues: [{ title: 'Open a barset', members: ['0', '1', 1] }] }, 3), [{ title: 'Open a barset', members: [0, 1] }]);
  assert.deepEqual(parseAssignments({ assignments: [{ index: '0', issue: '1' }, { index: '1', issue: '-1' }] }, 2, 2), [1, -1]);
});

test('summarise stops on errors that are not about the model', async () => {
  let count = 0;
  const chatFn = async () => { count += 1; throw new Error('Rate limited'); };
  await assert.rejects(summarise(report, { chatFn, models: ['a', 'b'] }), /Rate limited/);
  assert.equal(count, 1);
});

const deviceGroups = [
  { theme: 'Vpos stuck', count: 194, previousCount: 58, tickets: [{ summary: 'RYR - EDI - VPOS STUCK' }] },
  { theme: 'Vpos crash', count: 138, previousCount: 75, estimated: true, tickets: [{ summary: 'RYR - VPOS CRASH' }] },
  { theme: 'Pinpad connection', count: 93, previousCount: 72, tickets: [{ summary: 'Blue Pad Connection' }] },
  { theme: 'Pair pinpad', count: 47, previousCount: 75, tickets: [{ summary: 'Pair pin pad with vpos' }] },
  { theme: 'Missing product', count: 61, previousCount: 5, tickets: [{ summary: 'Missing Product' }] },
];

test('suggestCategories forces the category tool and validates indexes', async () => {
  let prompt;
  const chatFn = async (p) => {
    prompt = p;
    return { choices: [{ message: { tool_calls: [{ function: { name: 'categorise_patterns', arguments: JSON.stringify({ categories: [
      { title: 'vPOS app', members: [0, 1, 99] },
      { title: 'Payment devices', members: [2, 3, 0] },
    ] }) } }] } }] };
  };
  const result = await suggestCategories({ groups: deviceGroups, synonyms: [['pinpad', 'bluepad']] }, { chatFn, models: ['claude-sonnet-5'] });
  assert.equal(prompt.tool_choice.function.name, 'categorise_patterns');
  assert.match(prompt.messages[1].content, /"pinpad","bluepad"/);
  assert.equal(JSON.parse(prompt.messages[1].content.split('Patterns as JSON:\n')[1]).length, 5);
  assert.deepEqual(result.categories, [{ title: 'vPOS app', members: [0, 1] }, { title: 'Payment devices', members: [2, 3] }]);
  assert.ok(MAX_CATEGORIES >= 8);
});

test('suggestCategories skips the call for fewer than three patterns', async () => {
  const result = await suggestCategories({ groups: deviceGroups.slice(0, 2) }, { chatFn: async () => { throw new Error('called'); } });
  assert.deepEqual(result, { categories: [], model: null });
});

test('categories total their patterns; anything left out goes under Other', () => {
  const categories = categoriesOf(deviceGroups, [{ title: 'Payment devices', members: [3, 2] }, { title: 'vPOS app', members: [0, 1, 2] }]);
  assert.deepEqual(categories.map((c) => [c.title, c.count, c.previousCount, c.members]), [
    ['vPOS app', 332, 133, [0, 1]],
    ['Payment devices', 140, 147, [2, 3]],
    ['Other', 61, 5, [4]],
  ]);
  assert.equal(categories[0].estimated, true);
  assert.equal(categories[0].changePercent, 150);
  assert.equal(categories[1].change, -7);
  // The AI's own "Other" takes the leftovers.
  assert.deepEqual(categoriesOf(deviceGroups, [{ title: 'Devices', members: [0, 1, 2, 3] }, { title: 'other', members: [] }]).map((c) => c.title), ['Devices', 'other']);
});

test('the summary prompt gets category totals', () => {
  const input = aiInput({ ...report, categories: categoriesOf(deviceGroups, [{ title: 'vPOS app', members: [0, 1] }]) });
  assert.deepEqual(input.categories[0], { name: 'vPOS app', tickets: 332, previousPeriodTickets: 133, patterns: 2 });
  assert.deepEqual(aiInput(report).categories, []);
});
