// Live surge detection. Every five minutes, the last hour (the admin's window)
// of each watched organisation's tickets is grouped like a report. A group that
// reaches the admin's thresholds (enough tickets, several times its normal rate
// for the time of week, optionally from several bases) is a surge: agents see
// it in the app and, if switched on, one incident ticket is raised (P2 by
// default, so System Alert Manager's "Send System Alert" is available on it)
// with the matching tickets linked. Later tickets on the same surge are added
// to that ticket instead of raising another.
import { groupIssues } from './analysis.js';

export const SURGE_LIMITS = {
  windowMinutes: { min: 15, max: 240, default: 60 },
  minTickets: { min: 3, max: 200, default: 6 },
  multiple: { min: 2, max: 20, default: 3 },
  minBases: { min: 0, max: 50, default: 0 },
};
export const MAX_SURGE_ORGS = 10;
export const MAX_COPY_FIELDS = 5;
const BASELINE_DAYS = 7;
const KEEP_OPEN_MS = 6 * 3600000; // a surge with no new tickets for this long is over
const MAX_LINKS = 50;
const MAX_FETCH = 200;
const COPYABLE = ['option', 'options', 'cascading', 'strings'];
export const SURGE_LABEL = 'customer-insights-surge';

export const DEFAULT_SURGE = {
  enabled: false,
  organizations: [],
  windowMinutes: SURGE_LIMITS.windowMinutes.default,
  minTickets: SURGE_LIMITS.minTickets.default,
  multiple: SURGE_LIMITS.multiple.default,
  minBases: SURGE_LIMITS.minBases.default,
  baseFieldId: '',
  createIssue: false,
  projectKey: 'SD',
  issueTypeName: 'Incident',
  issueTypeId: '',
  priorityName: 'P2',
  copyFields: [],
};

// Same as engine.js (not imported: this file also loads in the settings page).
const escapeJql = (value) => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const clip = (value, length) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, length);
const whole = (value, { min, max, default: fallback }) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

/**
 * Validates surge settings. Organisations must be ones the admin can see;
 * the base field must be a breakdown; copied fields must be selectable fields
 * that hold choices (never the Organizations field: an incident ticket must
 * not be shared with the customer). The issue type id is resolved on save.
 */
export function sanitizeSurge(input, organizations = [], breakdowns = [], selectable = []) {
  const known = new Map(organizations.map((o) => [String(o.id), o]));
  const seen = new Set();
  const watched = (Array.isArray(input?.organizations) ? input.organizations : [])
    .map((o) => known.get(String(o?.id ?? o)))
    .filter((o) => o && !seen.has(o.id) && seen.add(o.id))
    .slice(0, MAX_SURGE_ORGS)
    .map(({ id, name }) => ({ id: String(id), name: String(name) }));
  const fields = new Map(selectable.map((f) => [f.id, f]));
  const copied = new Set();
  return {
    enabled: input?.enabled === true,
    organizations: watched,
    windowMinutes: whole(input?.windowMinutes, SURGE_LIMITS.windowMinutes),
    minTickets: whole(input?.minTickets, SURGE_LIMITS.minTickets),
    multiple: whole(input?.multiple, SURGE_LIMITS.multiple),
    minBases: whole(input?.minBases, SURGE_LIMITS.minBases),
    baseFieldId: breakdowns.some((b) => b.id === String(input?.baseFieldId)) ? String(input.baseFieldId) : '',
    createIssue: input?.createIssue === true,
    projectKey: clip(input?.projectKey, 50).toUpperCase(),
    issueTypeName: clip(input?.issueTypeName, 60) || DEFAULT_SURGE.issueTypeName,
    issueTypeId: /^\d{1,18}$/.test(String(input?.issueTypeId)) ? String(input.issueTypeId) : '',
    priorityName: clip(input?.priorityName, 60),
    copyFields: (Array.isArray(input?.copyFields) ? input.copyFields : [])
      .map((id) => fields.get(String(id?.id ?? id)))
      .filter((f) => f && COPYABLE.includes(f.kind) && !copied.has(f.id) && copied.add(f.id))
      .slice(0, MAX_COPY_FIELDS)
      .map((f) => ({ id: f.id, name: f.name, kind: f.kind })),
  };
}

/** Words for a text search that finds the pattern's earlier tickets: "vpos stuck". */
export function searchWords(theme) {
  return [...new Set(String(theme).toLowerCase().match(/[a-z][a-z0-9]{2,}/g) || [])].slice(0, 4).join(' ');
}

/** Normal tickets per window from a count over the previous BASELINE_DAYS. */
export const baselinePerWindow = (count, windowMinutes) => (count * windowMinutes) / (BASELINE_DAYS * 24 * 60);

/**
 * Candidate surges among the window's tickets: groups with at least
 * `minTickets`, from at least `minBases` bases when that's set. Baselines are
 * checked afterwards, as each needs a Jira count.
 */
export function surgeCandidates(issues, config, synonyms = []) {
  return groupIssues(issues, 0.4, synonyms)
    .filter((g) => g.count >= config.minTickets)
    .map((g) => {
      const keys = new Set(g.keys);
      const bases = config.baseFieldId
        ? [...new Set(issues.filter((i) => keys.has(i.key)).flatMap((i) => i.dims?.[config.baseFieldId] || []))]
        : [];
      return { theme: clip(g.theme, 120), count: g.count, keys: g.keys, bases, examples: g.tickets.slice(0, 5).map((t) => ({ key: t.key, summary: clip(t.summary, 200) })) };
    })
    .filter((c) => !config.minBases || c.bases.length >= config.minBases);
}

/** True when `count` is at least `multiple` times normal (normal is at least 1). */
export const isSurge = (count, baseline, multiple) => count >= multiple * Math.max(1, baseline);

/** An earlier surge this one continues: shares a ticket or has the same name, and is still active. */
export function openSurgeFor(candidate, incidents = [], now = Date.now()) {
  const keys = new Set(candidate.keys);
  const name = candidate.theme.toLowerCase();
  return incidents.find((s) => now - Date.parse(s.updatedAt) < KEEP_OPEN_MS && (s.theme.toLowerCase() === name || s.keys.some((k) => keys.has(k)))) || null;
}

/** A copied field value in the form POST /rest/api/3/issue expects, or undefined. */
export function copyValue(raw, kind) {
  if (raw === null || raw === undefined) return undefined;
  if (kind === 'option') return raw.id ? { id: String(raw.id) } : undefined;
  if (kind === 'options') return Array.isArray(raw) && raw.length ? raw.filter((v) => v?.id).map((v) => ({ id: String(v.id) })) : undefined;
  if (kind === 'cascading') return raw.id ? { id: String(raw.id), ...(raw.child?.id ? { child: { id: String(raw.child.id) } } : {}) } : undefined;
  if (kind === 'strings') return Array.isArray(raw) && raw.length ? raw.map(String) : undefined;
  return undefined;
}

/** The most common value of each copied field across the surge's tickets. */
export function copiedFields(issues, keys, copyFields) {
  const inSurge = issues.filter((i) => keys.includes(i.key));
  const out = {};
  for (const f of copyFields) {
    const tally = new Map();
    for (const issue of inSurge) {
      const value = copyValue(issue.fields?.[f.id], f.kind);
      if (value === undefined) continue;
      const k = JSON.stringify(value);
      tally.set(k, (tally.get(k) || 0) + 1);
    }
    const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    if (best) out[f.id] = JSON.parse(best[0]);
  }
  return out;
}

const text = (value) => ({ type: 'text', text: value });
const link = (value, href) => ({ type: 'text', text: value, marks: [{ type: 'link', attrs: { href } }] });
const paragraph = (...content) => ({ type: 'paragraph', content });
const normalText = (baseline) => (baseline < 1 ? 'normally fewer than 1' : `normally about ${Math.round(baseline)}`);

/** "8 tickets in the last 60 minutes (normally fewer than 1), from 5 bases" */
export function surgeText(s) {
  return `${s.count} tickets in the last ${s.windowMinutes} minutes (${normalText(s.baseline)})${s.bases?.length ? `, from ${s.bases.length} ${s.bases.length === 1 ? 'base' : 'bases'}` : ''}`;
}

function surgeDoc(surge, siteUrl, intro) {
  const keyNode = (key) => (siteUrl ? link(key, `${siteUrl}/browse/${key}`) : text(key));
  const content = [paragraph(text(intro))];
  if (surge.bases?.length) content.push(paragraph(text(`Bases: ${surge.bases.slice(0, 30).join(', ')}${surge.bases.length > 30 ? ' …' : ''}.`)));
  if (surge.examples.length) {
    content.push({ type: 'bulletList', content: surge.examples.map((e) => ({ type: 'listItem', content: [paragraph(keyNode(e.key), text(` ${e.summary}`))] })) });
  }
  if (siteUrl && surge.keys.length) {
    content.push(paragraph(link(`Open all ${Math.min(surge.keys.length, MAX_LINKS)} tickets in Jira`, `${siteUrl}/issues/?jql=${encodeURIComponent(`key in (${surge.keys.slice(0, MAX_LINKS).join(', ')}) ORDER BY created DESC`)}`)));
  }
  return { type: 'doc', version: 1, content };
}

/** Fields for the incident ticket. */
export function incidentFields(surge, config, copied = {}, siteUrl = '') {
  const intro = `Customer Insights detected a surge for ${surge.organization.name}: "${surge.theme}", ${surgeText(surge)}. The matching tickets are linked. Grouping comes from ticket text: check them before alerting anyone.`;
  return {
    ...copied,
    project: { key: config.projectKey },
    issuetype: { id: config.issueTypeId },
    ...(config.priorityName ? { priority: { name: config.priorityName } } : {}),
    summary: clip(`Possible incident: ${surge.theme} (${surge.organization.name}, ${surge.count} tickets in ${surge.windowMinutes} min)`, 250),
    labels: [SURGE_LABEL],
    description: surgeDoc(surge, siteUrl, intro),
  };
}

/** A comment for an incident when more tickets arrive. */
export function updateComment(surge, added, siteUrl = '') {
  return surgeDoc({ ...surge, examples: surge.examples.filter((e) => added.includes(e.key)) }, siteUrl,
    `${added.length} more ${added.length === 1 ? 'ticket' : 'tickets'} on this surge; ${surgeText(surge)}. Now ${surge.keys.length} linked in total.`);
}

/**
 * Checks one watched organisation. `jira` does the Jira calls (as the app) and
 * `store` keeps alerts and surge state; both are passed in so tests can fake them.
 */
export async function checkSurges(organization, settings, { jira, store, now = Date.now() }) {
  const config = settings.surge;
  const breakdowns = settings.breakdowns || [];
  const orgClause = `organizations = "${escapeJql(organization.name)}"`;
  const extra = [...breakdowns, ...config.copyFields.map((f) => ({ id: f.id, kind: null }))];
  const issues = await jira.search(`${orgClause} AND created >= "-${config.windowMinutes}m"`, MAX_FETCH, extra);
  const state = await store.loadSurgeState(organization.id);
  const incidents = (state.incidents || []).filter((s) => now - Date.parse(s.updatedAt) < KEEP_OPEN_MS);
  const results = [];
  for (const candidate of surgeCandidates(issues, config, settings.synonyms)) {
    const existing = openSurgeFor(candidate, incidents, now);
    const words = searchWords(candidate.theme);
    let baseline = existing?.baseline;
    if (baseline === undefined) {
      const before = words ? await jira.count(`${orgClause} AND text ~ "${escapeJql(words)}" AND created >= "-${BASELINE_DAYS}d" AND created < "-${config.windowMinutes}m"`) : 0;
      baseline = baselinePerWindow(before, config.windowMinutes);
    }
    if (!existing && !isSurge(candidate.count, baseline, config.multiple)) continue;
    const surge = { ...candidate, baseline, windowMinutes: config.windowMinutes, organization };
    if (existing) {
      const added = candidate.keys.filter((k) => !existing.keys.includes(k));
      if (!added.length) continue;
      existing.keys = [...existing.keys, ...added].slice(0, 500);
      existing.updatedAt = new Date(now).toISOString();
      existing.count = Math.max(existing.count, candidate.count);
      existing.bases = [...new Set([...(existing.bases || []), ...candidate.bases])];
      if (existing.issueKey) {
        try {
          const linkable = added.slice(0, Math.max(0, MAX_LINKS - existing.linked));
          existing.linked += await jira.link(existing.issueKey, linkable);
          await jira.comment(existing.issueKey, updateComment({ ...surge, keys: existing.keys, bases: existing.bases }, added, jira.siteUrl));
        } catch (error) { existing.issueError = clip(error.message, 300); }
      }
      await store.updateAlert(existing.alertId, { count: existing.count, keys: existing.keys.slice(0, 100), surge: { ...existing.surgeInfo, bases: existing.bases.length, updatedAt: existing.updatedAt } });
      results.push({ updated: existing.issueKey || existing.alertId, added: added.length });
      continue;
    }
    const createdAt = new Date(now).toISOString();
    const today = createdAt.slice(0, 10);
    const alert = {
      id: `surge-${now}-${organization.id}-${results.length}`,
      kind: 'surge',
      organization,
      theme: surge.theme,
      count: surge.count,
      keys: surge.keys.slice(0, 100),
      examples: surge.examples.slice(0, 3),
      window: { from: today, to: today },
      surge: { windowMinutes: config.windowMinutes, baseline: Math.round(baseline * 10) / 10, bases: surge.bases.length, startedAt: createdAt, updatedAt: createdAt },
      createdAt,
    };
    let linked = 0;
    if (config.createIssue && config.projectKey && config.issueTypeId) {
      try {
        alert.issueKey = await jira.createIssue(incidentFields(surge, config, copiedFields(issues, surge.keys, config.copyFields), jira.siteUrl));
        linked = await jira.link(alert.issueKey, surge.keys.slice(0, MAX_LINKS));
      } catch (error) { alert.issueError = clip(error.message, 300); }
    }
    await store.saveAlert(alert);
    incidents.push({ theme: surge.theme, keys: surge.keys, bases: surge.bases, count: surge.count, baseline, issueKey: alert.issueKey || null, alertId: alert.id, linked, surgeInfo: alert.surge, createdAt, updatedAt: createdAt });
    results.push({ created: alert.issueKey || alert.id, count: surge.count });
  }
  await store.saveSurgeState(organization.id, { checkedAt: new Date(now).toISOString(), incidents, lastError: null });
  return { tickets: issues.length, results };
}
