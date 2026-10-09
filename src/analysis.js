import { gridOf, hoursOf, validTimeZone } from './timeOfDay.js';

const STOP = new Set(`about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not of off on once only or other our ours ourselves out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why with would you your yours a au aux avec ces dans de des du elle en est et eux il je la le les leur lui ma mais mes moi mon ne nos notre nous on ou par pas pour qu que quel quelle quels qui sa sans se ses son sur ta te tes toi ton tu un une vos votre vous c est d l j n s m`.split(/\s+/));

// Words that say nothing about which problem a ticket is about.
const GENERIC = new Set('issue issues problem problems please help request ticket hello thanks thank regards team kind dear will cannot cant need'.split(' '));
// "RYR - KURVIK - PFO - DEVICE CRASHES": customer, crew and airport codes are
// single all-caps tokens. They identify who and where, not what went wrong.
const DATE_OR_REF = /^([A-Z]{2,5}\d{2,8}|\d{1,2}[./]\d{1,2}([./]\d{2,4})?)$/;
const CODE_SEGMENT = /^[A-Z0-9]{2,8}$/;
const isCode = (s) => CODE_SEGMENT.test(s) || DATE_OR_REF.test(s);
// Dates (19.07.2026, 07.08) and references (no.DUB24150) inside the text.
const REFERENCE = /\b(no\.?\s*)?([A-Z]{2,5}\d{3,}|\d{1,2}[./]\d{1,2}([./]\d{2,4})?)\b/gi;

/** Visible text of a plain string or an Atlassian Document Format node. */
export function textOf(value, output = []) {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => textOf(item, output));
  else if (value && typeof value === 'object') {
    if (typeof value.text === 'string') output.push(value.text);
    if (value.content) textOf(value.content, output);
  }
  return output;
}

/** Summary without its code segments. The last segment is kept: it is usually the problem. */
export function problemText(summary) {
  const normalised = summary
    .replace(/\s*\/\/\s*/g, ' - ') // "OPEN BARSET // LIS // 07.08"
    .replace(/(^|[\s-])([A-Z0-9]{2,8})-(?=\S)/g, '$1$2 - ') // "RYR-BOND-open barset"
    .replace(/(^|[\s-])([A-Z0-9]{2,8})-(?=\S)/g, '$1$2 - '); // second pass for chained codes
  const segments = normalised.split(/\s+[-\u2013\u2014|:]\s+/).map((s) => s.trim()).filter(Boolean);
  if (segments.length < 2) return normalised.replace(REFERENCE, ' ');
  const words = segments.filter((s) => !isCode(s));
  if (words.length) return words.join(' ').replace(REFERENCE, ' ');
  // Only codes ("RYR - CAUGAR - TSF"): the last non-date one is the problem.
  let last = segments.length - 1;
  while (last > 0 && DATE_OR_REF.test(segments[last])) last -= 1;
  return segments[last];
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Same-meaning word lists ([["pinpad", "bluepad", "pin pad"], …]) as one
 * replacer: every word in a list, in any case, with spaces or hyphens between
 * its parts and an optional plural, becomes the list's first word.
 */
export function synonymReplacer(lists = []) {
  const canonical = new Map();
  for (const list of Array.isArray(lists) ? lists : []) {
    const words = (Array.isArray(list) ? list : []).map((w) => String(w ?? '').toLowerCase().replace(/\s+/g, ' ').trim()).filter(Boolean);
    for (const w of words.slice(1)) if (!canonical.has(w)) canonical.set(w, words[0]);
  }
  if (!canonical.size) return (text) => text;
  // Longest first, so "pin pad terminal" wins over "pin pad".
  const variants = [...canonical.keys()].sort((a, b) => b.length - a.length);
  const pattern = new RegExp(`(?<![a-z0-9])(${variants.map((v) => v.split(' ').map(escape).join('[\\s-]*')).join('|')})(?:e?s)?(?![a-z0-9])`, 'gi');
  const target = (match) => canonical.get(match.toLowerCase().replace(/[\s-]+/g, ' ')) ?? canonical.get(match.toLowerCase().replace(/[\s-]+/g, ' ').replace(/e?s$/, ''));
  return (text) => text.replace(pattern, (match, word) => ` ${target(word) ?? word} `);
}

function rawWords(text) {
  return text.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().match(/[a-z0-9]{3,}/g) || [];
}

/** Light English stemmer: crash / crashes / crashing, charge / charging. */
export function stem(word) {
  let s = word;
  if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith('ed')) s = s.slice(0, -2);
  else if (s.length > 4 && /(sh|ch|x|ss)es$/.test(s)) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  if (s.length > 4 && s.endsWith('e')) s = s.slice(0, -1);
  return s;
}

const meaningful = (w) => !STOP.has(w) && !GENERIC.has(w);

/** stem -> the word as first written, so themes read naturally. */
function terms(words) {
  const out = new Map();
  for (const w of words) if (meaningful(w) && !out.has(stem(w))) out.set(stem(w), w);
  return out;
}

export function tokenize(issue, same = (text) => text) {
  const summary = issue.fields?.summary || issue.summary || '';
  const words = rawWords(same(problemText(summary)));
  const surface = terms(words);
  // "pin pad" also yields "pinpad", so it matches tickets that spell it as one word.
  const compounds = new Map();
  for (let i = 0; i + 1 < words.length; i += 1) {
    const [a, b] = [words[i], words[i + 1]];
    const key = stem(a + b);
    if (meaningful(a) && meaningful(b) && !surface.has(key)) compounds.set(key, [stem(a), stem(b)]);
  }
  compounds.forEach((_, key) => surface.set(key, key));
  // Resolved against the whole batch in vectorise().
  return {
    summary,
    summaryWords: [...surface.keys()],
    surface,
    compounds,
    descriptionWords: [...terms(rawWords(same(textOf(issue.fields?.description ?? issue.description).join(' ')))).keys()],
  };
}

const SUMMARY_WEIGHT = 3;
// Words in more than this share of a batch are template text or prefixes.
const MAX_SHARE = 0.5;

/**
 * TF-IDF vectors over the batch. Words that appear in most tickets are
 * dropped, rare words count more, and summary words count three times as much
 * as description words.
 */
function vectorise(rows) {
  // Keep a joined pair ("pinpad" from "pin pad") only when another ticket uses
  // it as one word; then it replaces its parts so both spellings match.
  const realWords = new Set();
  for (const { tokenized } of rows) {
    tokenized.summaryWords.forEach((w) => { if (!tokenized.compounds.has(w)) realWords.add(w); });
    tokenized.descriptionWords.forEach((w) => realWords.add(w));
  }
  for (const { tokenized } of rows) {
    for (const [key, parts] of tokenized.compounds) {
      if (!realWords.has(key)) {
        tokenized.summaryWords = tokenized.summaryWords.filter((w) => w !== key);
        tokenized.compounds.delete(key);
        continue;
      }
      tokenized.summaryWords = tokenized.summaryWords.filter((w) => !parts.includes(w));
      if (parts.every((p) => tokenized.descriptionWords.includes(p))) {
        tokenized.descriptionWords = [...tokenized.descriptionWords.filter((w) => !parts.includes(w)), key];
      }
      tokenized.surface.set(key, parts.map((p) => tokenized.surface.get(p) || p).join(' '));
    }
  }
  const df = new Map();
  const descriptionDf = new Map();
  for (const { tokenized } of rows) {
    for (const word of new Set([...tokenized.summaryWords, ...tokenized.descriptionWords])) df.set(word, (df.get(word) || 0) + 1);
    for (const word of tokenized.descriptionWords) descriptionDf.set(word, (descriptionDf.get(word) || 0) + 1);
  }
  const n = rows.length;
  // Template text lives in descriptions. Summary words are never dropped (a
  // small customer's main problem can be in most summaries); IDF weighs them.
  const tooCommon = (word) => n >= 6 && (descriptionDf.get(word) || 0) > n * MAX_SHARE;
  // A word only one ticket uses can't match anything, so it mostly dilutes.
  const idf = (word) => Math.log(1 + n / df.get(word)) * (n >= 6 && df.get(word) === 1 ? 0.5 : 1);
  for (const { tokenized } of rows) {
    const vector = new Map();
    for (const w of tokenized.summaryWords) vector.set(w, SUMMARY_WEIGHT * idf(w));
    for (const w of tokenized.descriptionWords) if (!tooCommon(w) && !vector.has(w)) vector.set(w, idf(w));
    let squared = 0;
    for (const x of vector.values()) squared += x * x;
    tokenized.vector = vector;
    tokenized.norm = Math.sqrt(squared);
  }
  return df;
}

// A summary word in more than this share of tickets ("vpos", "app") would make
// every ticket compare with thousands of one-ticket clusters. For such words
// the lookup holds every cluster with 2+ tickets but only the most recent
// single-ticket ones, which is enough for new pairs to form.
const BROAD_SHARE = 0.02;
const BROAD_MIN_ROWS = 500;
const RECENT_SINGLES = 200;

function newCluster(row) {
  const cluster = { members: [], centroid: new Map(), squared: 0, summaryWords: new Set() };
  addToCluster(cluster, row);
  return cluster;
}

function addToCluster(cluster, row) {
  cluster.members.push(row);
  for (const [word, x] of row.tokenized.vector) {
    const old = cluster.centroid.get(word) || 0;
    cluster.centroid.set(word, old + x);
    cluster.squared += (old + x) ** 2 - old ** 2;
  }
  row.tokenized.summaryWords.forEach((w) => cluster.summaryWords.add(w));
}

function cosineToCluster(row, cluster) {
  if (!row.tokenized.norm || !cluster.squared) return 0;
  let dot = 0;
  for (const [word, x] of row.tokenized.vector) dot += x * (cluster.centroid.get(word) || 0);
  return dot / (row.tokenized.norm * Math.sqrt(cluster.squared));
}

/** The words most members' summaries share, in the order the best example uses them. */
function themeName(members, representative) {
  const counts = new Map();
  for (const { tokenized } of members) tokenized.summaryWords.forEach((w) => counts.set(w, (counts.get(w) || 0) + 1));
  const { surface } = representative.tokenized;
  let shared = representative.tokenized.summaryWords.filter((w) => counts.get(w) * 2 > members.length);
  if (!shared.length) shared = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w);
  const text = [...new Set(shared.slice(0, 4).map((w) => surface.get(w) || w))].join(' ');
  return text ? text[0].toUpperCase() + text.slice(1) : 'Similar requests';
}

/**
 * Deterministic, explainable grouping. Each ticket joins the cluster whose
 * centroid it is most like (and shares a summary word with), or starts its own.
 * Comparing with the whole cluster, not single tickets, stops one loose match
 * from chaining unrelated tickets together. Bounded for interactive use.
 */
function cluster(issues, threshold, limit, synonyms = []) {
  const same = synonymReplacer(synonyms);
  const rows = issues.slice(0, limit).map((issue) => ({ issue, tokenized: tokenize(issue, same) }));
  const df = vectorise(rows);
  rows.sort((a, b) => Date.parse(a.issue.fields.created) - Date.parse(b.issue.fields.created));
  const clusters = [];
  const bySummaryWord = new Map(); // word -> clusters (for broad words: 2+ tickets only)
  const recentSingles = new Map(); // broad word -> newest single-ticket clusters
  const broad = (w) => rows.length >= BROAD_MIN_ROWS && df.get(w) > rows.length * BROAD_SHARE;
  const post = (w, c) => {
    if (!bySummaryWord.has(w)) bySummaryWord.set(w, new Set());
    bySummaryWord.get(w).add(c);
  };
  for (const row of rows) {
    const candidates = new Set();
    for (const w of row.tokenized.summaryWords) {
      for (const c of bySummaryWord.get(w) || []) candidates.add(c);
      for (const c of recentSingles.get(w) || []) candidates.add(c);
    }
    let best = null;
    let bestScore = threshold;
    for (const cluster of candidates) {
      const score = cosineToCluster(row, cluster);
      if (score >= bestScore) { best = cluster; bestScore = score; }
    }
    if (best) {
      addToCluster(best, row);
      // Now 2+ tickets: reachable through all its words, broad ones included.
      for (const w of best.summaryWords) post(w, best);
    } else {
      const single = newCluster(row);
      clusters.push(single);
      for (const w of row.tokenized.summaryWords) {
        if (!broad(w)) { post(w, single); continue; }
        const list = recentSingles.get(w) || [];
        list.push(single);
        if (list.length > RECENT_SINGLES) list.shift();
        recentSingles.set(w, list);
      }
    }
  }
  return clusters;
}

/** A cluster as shown: named from all its members, evidence from `shown`. */
function describe(found, shown = found.members) {
  const representative = found.members.reduce((a, b) => (cosineToCluster(b, found) > cosineToCluster(a, found) ? b : a));
  const ordered = shown.map(({ issue }) => issue).sort((a, b) => Date.parse(b.fields.created) - Date.parse(a.fields.created));
  return {
    id: ordered.map((issue) => issue.key).sort().join('-'),
    theme: themeName(found.members, representative),
    count: ordered.length,
    tickets: ordered.slice(0, 8).map((issue) => ({
      key: issue.key,
      summary: issue.fields.summary || '(No summary)',
      status: issue.fields.status?.name || 'Unknown',
      created: issue.fields.created,
      url: issue.self ? issue.self.replace(/\/rest\/api\/.*$/, '/browse/' + issue.key) : issue.key,
    })),
    sampleSummary: representative.issue.fields.summary || '(No summary)',
    // Every analysed ticket in the pattern, for "Open in Jira" (agents only).
    keys: ordered.map((issue) => issue.key),
    // Hours to resolve for resolved tickets, and how many are still open.
    resolvedHours: ordered.map(resolutionHours).filter((h) => h !== null),
    openCount: ordered.filter((issue) => resolutionHours(issue) === null).length,
  };
}

export function groupIssues(issues, threshold = 0.4, synonyms = []) {
  return cluster(issues, threshold, 900, synonyms)
    .filter((found) => found.members.length > 1)
    .map((found) => describe(found))
    .sort((a, b) => b.count - a.count);
}

// ---- Resolution time ----------------------------------------------------------

/** Hours from created to resolved, or null while the ticket is open. */
export function resolutionHours(issue) {
  const created = Date.parse(issue?.fields?.created);
  const resolved = Date.parse(issue?.fields?.resolutiondate);
  if (!Number.isFinite(created) || !Number.isFinite(resolved) || resolved < created) return null;
  return Math.round(((resolved - created) / 3600000) * 10) / 10;
}

export function median(values) {
  const sorted = (values || []).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
}

/** Median hours to resolve and share still open, for a set of tickets. */
export function resolutionOf(issues) {
  const hours = issues.map(resolutionHours);
  const resolved = hours.filter((h) => h !== null);
  return {
    medianHours: median(resolved),
    openShare: issues.length ? Math.round(((issues.length - resolved.length) / issues.length) * 100) : null,
  };
}

// ---- Breakdowns by admin-chosen fields ---------------------------------------
// Issues carry `dims`: { fieldId: [values] } (see settings.js dimensionsOf).

/** { fieldId: { value: tickets } } for a set of issues. */
export function dimCountsOf(issues) {
  const counts = {};
  for (const issue of issues) {
    for (const [id, values] of Object.entries(issue.dims || {})) {
      counts[id] ||= {};
      for (const v of values) counts[id][v] = (counts[id][v] || 0) + 1;
    }
  }
  return counts;
}

function addDimCounts(a = {}, b = {}) {
  const out = structuredClone(a);
  for (const [id, values] of Object.entries(b)) {
    out[id] ||= {};
    for (const [v, n] of Object.entries(values)) out[id][v] = (out[id][v] || 0) + n;
  }
  return out;
}

/** A pattern's top values for one field, as shares of its sampled tickets. */
export function topShares(group, fieldId, limit = 3) {
  const counts = group?.dimCounts?.[fieldId] || {};
  const total = group?.sampleCount || Object.values(counts).reduce((s, n) => s + n, 0) || 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([value, n]) => ({ value, share: Math.round((n / total) * 100) }));
}

const BREAKDOWN_VALUES = 10;
// Every value's counts, for rates against crew numbers (headcount.js).
const BREAKDOWN_ALL = 300;

function buildBreakdowns(breakdowns, current, previous, currentScale, previousScale) {
  const now = dimCountsOf(current);
  const before = dimCountsOf(previous);
  return breakdowns.map(({ id, label }) => {
    const cur = now[id] || {};
    const prev = before[id] || {};
    const values = Object.keys({ ...cur, ...prev })
      .map((value) => {
        const count = Math.round((cur[value] || 0) * currentScale);
        const previousCount = Math.round((prev[value] || 0) * previousScale);
        const withValue = current.filter((issue) => issue.dims?.[id]?.includes(value));
        return { value, count, previousCount, change: count - previousCount, ...resolutionOf(withValue) };
      })
      .filter((v) => v.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, BREAKDOWN_VALUES);
    const withValue = current.filter((issue) => issue.dims?.[id]?.length).length;
    const all = Object.keys({ ...cur, ...prev })
      .map((value) => [value, Math.round((cur[value] || 0) * currentScale), Math.round((prev[value] || 0) * previousScale)])
      .sort((a, b) => b[1] - a[1])
      .slice(0, BREAKDOWN_ALL);
    return { id, label, values, all, withoutValue: Math.round((current.length - withValue) * currentScale), estimated: currentScale > 1 };
  });
}

/**
 * Combines report groups that share a key (the same name, or an AI merge).
 * Clusters never share tickets, so counts add up. The first group of each key
 * (the largest, as groups arrive sorted) keeps its name and example.
 */
export function mergeGroups(groups, keyOf) {
  const merged = new Map();
  for (const group of groups) {
    const key = keyOf(group);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...group, tickets: [...group.tickets] });
      continue;
    }
    existing.id = `${existing.id}-${group.id}`;
    existing.count += group.count;
    existing.previousCount += group.previousCount;
    existing.sampleCount = (existing.sampleCount ?? 0) + (group.sampleCount ?? 0);
    existing.estimated = existing.estimated || group.estimated;
    existing.tickets = [...existing.tickets, ...group.tickets].sort((a, b) => Date.parse(b.created) - Date.parse(a.created)).slice(0, 8);
    existing.dimCounts = addDimCounts(existing.dimCounts, group.dimCounts);
    existing.keys = [...(existing.keys || []), ...(group.keys || [])];
    existing.resolvedHours = [...(existing.resolvedHours || []), ...(group.resolvedHours || [])];
    existing.openCount = (existing.openCount || 0) + (group.openCount || 0);
    if (existing.buckets && group.buckets) existing.buckets = existing.buckets.map((n, i) => n + (group.buckets[i] || 0));
    if (existing.hours && group.hours) existing.hours = existing.hours.map((n, i) => n + (group.hours[i] || 0));
  }
  return [...merged.values()]
    .map((g) => ({ ...g, change: g.count - g.previousCount, changePercent: g.previousCount ? Math.round(((g.count - g.previousCount) / g.previousCount) * 100) : null }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Applies AI merges ({ title, members: [group indexes] }) to report groups.
 * Issues take the AI title and keep the rule-based name(s) in ruleNames; a
 * one-member issue is just a rename.
 */
export function applyMerges(groups, merges) {
  const issueOf = new Map();
  merges.forEach((issue, n) => issue.members.forEach((index) => issueOf.set(index, n)));
  const keyed = groups.map((group, index) => ({ ...group, _key: issueOf.has(index) ? `ai:${issueOf.get(index)}` : `g:${index}` }));
  return mergeGroups(keyed, (g) => g._key).map(({ _key, ...group }) => {
    if (!_key.startsWith('ai:')) return group;
    const issue = merges[Number(_key.slice(3))];
    const ruleNames = issue.members.map((i) => groups[i].theme);
    return { ...group, theme: issue.title, ruleNames, ...(ruleNames.length > 1 ? { mergedFrom: ruleNames } : {}) };
  });
}

/**
 * Totals patterns into AI categories ({ title, members: [group indexes] }).
 * Groups are disjoint, so counts add up. Patterns left out (beyond what the AI
 * saw, or skipped) go under "Other". Biggest category first; each keeps its
 * pattern indexes, biggest first.
 */
export function categoriesOf(groups, categories) {
  const seen = new Set();
  const list = (categories || []).map((c) => ({ title: c.title, members: c.members.filter((i) => i >= 0 && i < groups.length && !seen.has(i) && seen.add(i)) }));
  const rest = groups.map((_, i) => i).filter((i) => !seen.has(i));
  if (rest.length) {
    const other = list.find((c) => /^other$/i.test(c.title));
    if (other) other.members.push(...rest); else list.push({ title: 'Other', members: rest });
  }
  return list.filter((c) => c.members.length).map((c) => {
    const members = [...c.members].sort((a, b) => groups[b].count - groups[a].count);
    const count = members.reduce((n, i) => n + groups[i].count, 0);
    const previousCount = members.reduce((n, i) => n + (groups[i].previousCount || 0), 0);
    return {
      title: c.title,
      members,
      count,
      previousCount,
      change: count - previousCount,
      changePercent: previousCount ? Math.round(((count - previousCount) / previousCount) * 100) : null,
      estimated: members.some((i) => groups[i].estimated),
    };
  }).sort((a, b) => b.count - a.count);
}

const DAY = 86400000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Chart buckets for a period: days up to 35 days, otherwise weeks starting on
 * Monday. `from`/`toExclusive` are clipped to the period so they can be used
 * directly in a JQL count.
 */
export function chartBuckets(periodStart, periodEnd) {
  const start = Date.parse(`${periodStart}T00:00:00Z`);
  const endExclusive = Date.parse(`${periodEnd}T00:00:00Z`) + DAY;
  const daily = (endExclusive - start) / DAY <= 35;
  let cursor = start;
  if (!daily) cursor -= ((new Date(start).getUTCDay() + 6) % 7) * DAY;
  const buckets = [];
  for (; cursor < endExclusive; cursor += daily ? DAY : 7 * DAY) {
    buckets.push({ date: isoDay(cursor), from: isoDay(Math.max(cursor, start)), toExclusive: isoDay(Math.min(cursor + (daily ? DAY : 7 * DAY), endExclusive)) });
  }
  return buckets;
}

/** Sampled tickets per chart bucket. */
function bucketCounts(issues, buckets) {
  const counts = new Array(buckets.length).fill(0);
  for (const issue of issues) {
    const day = isoDay(Date.parse(issue.fields.created));
    const index = buckets.findLastIndex((b) => b.date <= day);
    if (index >= 0) counts[index] += 1;
  }
  return counts;
}

/**
 * A pattern's tickets per chart bucket: its share of each bucket's sampled
 * tickets times that bucket's exact count. Sampling takes the newest tickets
 * of each slice, so raw sample counts would skew the shape; shares don't.
 * Exact when every ticket was analysed.
 */
export function patternTrend(group, report) {
  const series = report?.timeSeries || [];
  const samples = report?.bucketSamples || [];
  if (!Array.isArray(group?.buckets) || group.buckets.length !== series.length || !series.length) return null;
  // Days in each bucket: the first and last weeks are often partial.
  const buckets = report.startDate && report.endDate ? chartBuckets(report.startDate, report.endDate) : [];
  return series.map((point, i) => ({
    date: point.date,
    count: samples[i] ? Math.round((group.buckets[i] / samples[i]) * point.count) : 0,
    days: buckets.length === series.length ? Math.max(1, Math.round((Date.parse(buckets[i].toExclusive) - Date.parse(buckets[i].from)) / DAY)) : 1,
  }));
}

// ---- Data quality ------------------------------------------------------------

const normalValue = (v) => String(v).toLowerCase().replace(/\s+/g, ' ').trim();
const DATA_QUALITY_EXAMPLES = 5;

/**
 * Per breakdown field: tickets with no value or only a placeholder value
 * (e.g. "Unknown", "Please update"), scaled to the period when sampled.
 */
export function buildDataQuality(breakdowns, current, currentScale, placeholders = []) {
  const marks = new Set(placeholders.map(normalValue));
  const scale = (n) => Math.round(n * currentScale);
  // Organisation is always set on these tickets (it's how they were found).
  return breakdowns.filter((b) => b.kind !== 'organizations').map(({ id, label, kind }) => {
    const placeholderCounts = {};
    const problems = [];
    let missing = 0;
    for (const issue of current) {
      const values = issue.dims?.[id] || [];
      if (!values.length) { missing += 1; problems.push(issue); continue; }
      const marked = values.filter((v) => marks.has(normalValue(v)));
      for (const v of marked) placeholderCounts[v] = (placeholderCounts[v] || 0) + 1;
      if (marked.length === values.length) problems.push(issue);
    }
    const examples = problems
      .sort((a, b) => Date.parse(b.fields.created) - Date.parse(a.fields.created))
      .slice(0, DATA_QUALITY_EXAMPLES)
      .map((issue) => ({ key: issue.key, summary: issue.fields.summary || '(No summary)', value: issue.dims?.[id]?.join(', ') || '' }));
    return {
      id,
      label,
      kind,
      missing: scale(missing),
      placeholders: Object.entries(placeholderCounts).sort((a, b) => b[1] - a[1]).map(([value, n]) => ({ value, count: scale(n) })),
      problemCount: scale(problems.length),
      share: current.length ? Math.round((problems.length / current.length) * 100) : 0,
      examples,
      estimated: currentScale > 1,
    };
  });
}

/**
 * `totals` (optional) carries exact Jira counts when `issues` is only a sample:
 * { current, previous, timeSeries }. Pattern counts are then scaled from the
 * sample to the period total and flagged as estimates.
 */
/** Most tickets per period grouped in one Forge call (the browser passes Infinity). */
export const PERIOD_LIMIT = 900;

export function buildReport(issues, periodStart, periodEnd, totals = null, { limit = PERIOD_LIMIT, breakdowns = [], minPatternSize = 2, placeholders = [], synonyms = [], timeZone: zone = 'UTC' } = {}) {
  const timeZone = validTimeZone(zone);
  const minimum = Math.max(2, Number(minPatternSize) || 2);
  const from = Date.parse(periodStart);
  const to = Date.parse(periodEnd + 'T23:59:59Z');
  const duration = Math.max(1, to - from);
  const current = issues.filter((issue) => {
    const t = Date.parse(issue.fields.created);
    return t >= from && t <= to;
  });
  const previous = issues.filter((issue) => {
    const t = Date.parse(issue.fields.created);
    return t >= from - duration && t < from;
  });
  const currentCount = totals ? totals.current : current.length;
  const previousCount = totals ? totals.previous : previous.length;
  const currentScale = current.length ? Math.max(1, currentCount / current.length) : 1;
  const previousScale = previous.length ? Math.max(1, previousCount / previous.length) : 1;
  // Both periods are clustered together, so a pattern is the same group in each
  // period and its trend compares like with like. Counts are scaled per period.
  const currentKeys = new Set(current.map((issue) => issue.key));
  const buckets = chartBuckets(periodStart, periodEnd);
  const trends = cluster([...current.slice(0, limit), ...previous.slice(0, limit)], 0.4, Infinity, synonyms)
    .map((found) => {
      const now = found.members.filter((row) => currentKeys.has(row.issue.key));
      return { found, now, before: found.members.length - now.length };
    })
    .filter(({ now }) => now.length >= minimum)
    .map(({ found, now, before }) => {
      const group = describe(found, now);
      const count = Math.round(now.length * currentScale);
      const prior = Math.round(before * previousScale);
      return {
        ...group,
        sampleCount: now.length,
        count,
        estimated: currentScale > 1,
        previousCount: prior,
        change: count - prior,
        changePercent: prior ? Math.round(((count - prior) / prior) * 100) : null,
        dimCounts: dimCountsOf(now.map((row) => row.issue)),
        buckets: bucketCounts(now.map((row) => row.issue), buckets),
        hours: hoursOf(gridOf(now.map((row) => row.issue), timeZone)),
      };
    })
    .sort((a, b) => b.count - a.count);
  const groups = mergeGroups(trends, (g) => g.theme.toLowerCase());
  const bucketSamples = bucketCounts(current, buckets);
  const timeSeries = totals?.timeSeries || buckets.map((b, i) => ({ date: b.date, count: bucketSamples[i] }));
  return {
    currentCount,
    previousCount,
    change: currentCount - previousCount,
    changePercent: previousCount ? Math.round(((currentCount - previousCount) / previousCount) * 100) : null,
    groups,
    timeSeries,
    bucketSamples,
    // When tickets are created, in `timeZone`. Counts are of analysed tickets
    // (a sample for large organisations), so the page shows shares.
    timeOfDay: { timeZone, grid: gridOf(current, timeZone), analysed: current.length, estimated: currentScale > 1 },
    breakdowns: buildBreakdowns(breakdowns, current, previous, currentScale, previousScale),
    dataQuality: buildDataQuality(breakdowns, current, currentScale, placeholders),
    placeholders,
    // Same-meaning words used for grouping, so "Analyse every ticket" and the AI use them too.
    synonyms,
    resolution: resolutionOf(current),
    analyzedCount: Math.min(current.length, limit),
    sampled: currentScale > 1 || previousScale > 1,
    capped: current.length > limit || previous.length > limit,
    minPatternSize: minimum,
  };
}
