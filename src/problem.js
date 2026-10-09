// "Create problem" from a recurring issue: the Jira fields, built on the
// server from structured details the page sends (never ADF from the page).

export const MAX_LINKED = 20;
export const ISSUE_KEY = /^[A-Z][A-Z0-9_]{0,49}-\d{1,10}$/;
const PROJECT_KEY = /^[A-Z][A-Z0-9_]{0,49}$/;
const clip = (value, length) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, length);
const count = (value) => (Number.isFinite(Number(value)) ? Math.max(0, Math.round(Number(value))) : null);

/** Validated request: { projectKey, issueTypeName, summary, details, keys, link }. Throws on bad input. */
export function problemRequest(payload) {
  const projectKey = String(payload?.projectKey ?? '').trim().toUpperCase();
  if (!PROJECT_KEY.test(projectKey)) throw new Error('Enter the key of the project for the problem, such as PRB.');
  const summary = clip(payload?.summary, 250);
  if (!summary) throw new Error('Give the problem a summary.');
  const d = payload?.details || {};
  return {
    projectKey,
    issueTypeName: clip(payload?.issueTypeName, 60) || 'Problem',
    summary,
    link: payload?.link === true,
    keys: [...new Set((Array.isArray(payload?.keys) ? payload.keys : []).map((k) => String(k).trim()).filter((k) => ISSUE_KEY.test(k)))].slice(0, MAX_LINKED),
    details: {
      description: clip(d.description, 600),
      organisations: clip(d.organisations, 300),
      period: clip(d.period, 60),
      count: count(d.count),
      previousCount: count(d.previousCount),
      estimated: d.estimated === true,
      where: clip(d.where, 300),
      when: clip(d.when, 80),
      resolution: clip(d.resolution, 120),
      totalKeys: count(d.totalKeys),
    },
  };
}

const text = (value) => ({ type: 'text', text: value });
const strong = (value) => ({ type: 'text', text: value, marks: [{ type: 'strong' }] });
const link = (value, href) => ({ type: 'text', text: value, marks: [{ type: 'link', attrs: { href } }] });
const paragraph = (...content) => ({ type: 'paragraph', content: content.filter(Boolean) });
const item = (label, value) => ({ type: 'listItem', content: [paragraph(strong(`${label}: `), text(value))] });

/** Fields for POST /rest/api/3/issue. `siteUrl` turns ticket keys into links. */
export function problemFields(request, issueTypeId, siteUrl = '') {
  const { details: d, keys } = request;
  const approx = d.estimated ? '≈' : '';
  const facts = [
    d.organisations && item('Customer', d.organisations),
    d.period && item('Period', d.period),
    d.count !== null && item('Tickets', `${approx}${d.count}${d.previousCount !== null ? ` (previous period ${approx}${d.previousCount})` : ''}`),
    d.where && item('Where', d.where),
    d.when && item('When', d.when),
    d.resolution && item('Resolution', d.resolution),
  ].filter(Boolean);
  const content = [paragraph(text('Raised from a recurring issue found by Customer Insights.'))];
  if (d.description) content.push(paragraph(text(d.description)));
  if (facts.length) content.push({ type: 'bulletList', content: facts });
  if (keys.length) {
    const nodes = keys.flatMap((k, i) => [...(i ? [text(', ')] : []), siteUrl ? link(k, `${siteUrl}/browse/${k}`) : text(k)]);
    content.push(paragraph(strong(d.totalKeys && d.totalKeys > keys.length ? `Examples (${keys.length} of ${d.totalKeys}): ` : 'Examples: '), ...nodes));
  }
  content.push(paragraph(text('Patterns come from matching ticket text; review the examples before drawing conclusions.')));
  return {
    project: { key: request.projectKey },
    issuetype: { id: String(issueTypeId) },
    summary: request.summary,
    labels: ['customer-insights'],
    description: { type: 'doc', version: 1, content },
  };
}

/** The "relates to" link type from GET /rest/api/3/issueLinkType, or the first one. */
export function relatesLinkType(types) {
  const list = Array.isArray(types?.issueLinkTypes) ? types.issueLinkTypes : [];
  return list.find((t) => /^relates?$/i.test(String(t.name)) || /relates to/i.test(String(t.outward))) || list[0] || null;
}
