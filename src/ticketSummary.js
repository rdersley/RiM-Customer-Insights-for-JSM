// AI ticket summaries (src/ticketSummaryJobs.js): a short, customer-safe summary
// of a ticket's description and public comments, written to a text field the
// admin picks, so reports and exports can show what a ticket is about.
// Only what the customer can already see is sent: the summary, request type,
// status, description and comments shared with the customer. Never internal
// comments. This file also loads in the settings page: the AI call is in
// ticketSummaryAi.js.

export const MAX_SUMMARY_ORGS = 10;
export const SUMMARY_PROPERTY = 'retailinmotion.ticketSummary';
// A ticket is summarised once it has been quiet this long, so a burst of
// comments gives one summary.
export const QUIET_MINUTES = 20;
export const BACKFILL_LIMITS = { min: 1, max: 180, default: 30 };
// Bounds on what's sent to the model (cost is per token).
const MAX_DESCRIPTION = 3000;
const MAX_COMMENTS = 12;
const MAX_COMMENT = 800;
// Jira single-line text fields hold 255 characters.
const SHORT_TEXT = 255;

export const DEFAULT_TICKET_SUMMARY = { enabled: false, organizations: [], fieldId: '', backfillDays: BACKFILL_LIMITS.default };

const clip = (value, length) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, length);
const escapeJql = (value) => String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** Text fields an admin may pick for the summary: single-line or paragraph custom fields. */
export function summaryFieldChoices(fields) {
  return (Array.isArray(fields) ? fields : [])
    .filter((f) => f?.custom !== false && f?.schema?.type === 'string' && /:(textfield|textarea)$/.test(String(f.schema.custom || '')))
    .map((f) => ({ id: String(f.id), name: clip(f.name, 120), kind: String(f.schema.custom).endsWith(':textarea') ? 'textarea' : 'text' }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Validates the settings: known organisations only, and a field from the text-field list. */
export function sanitizeTicketSummary(input, organizations = [], fieldChoices = []) {
  const known = new Map(organizations.map((o) => [String(o.id), o]));
  const seen = new Set();
  const watched = (Array.isArray(input?.organizations) ? input.organizations : [])
    .map((o) => known.get(String(o?.id ?? o)))
    .filter((o) => o && !seen.has(String(o.id)) && seen.add(String(o.id)))
    .slice(0, MAX_SUMMARY_ORGS)
    .map(({ id, name }) => ({ id: String(id), name: String(name) }));
  const field = fieldChoices.find((f) => f.id === String(input?.fieldId ?? ''));
  const days = Number(input?.backfillDays);
  return {
    enabled: input?.enabled === true,
    organizations: watched,
    fieldId: field ? field.id : '',
    fieldKind: field ? field.kind : '',
    backfillDays: Number.isInteger(days) && days >= BACKFILL_LIMITS.min && days <= BACKFILL_LIMITS.max ? days : BACKFILL_LIMITS.default,
  };
}

export const ready = (config) => Boolean(config?.enabled && config.organizations?.length && config.fieldId);

export function organizationClause(organizations) {
  return organizations.length === 1
    ? `organizations = "${escapeJql(organizations[0].name)}"`
    : `organizations in (${organizations.map((o) => `"${escapeJql(o.name)}"`).join(', ')})`;
}

/** Tickets changed since `sinceMinutes` ago and quiet for QUIET_MINUTES, oldest change first. */
export function changedJql(organizations, sinceMinutes) {
  return `${organizationClause(organizations)} AND updated >= -${Math.ceil(sinceMinutes)}m AND updated <= -${QUIET_MINUTES}m ORDER BY updated ASC`;
}

export function backfillJql(organizations, days) {
  return `${organizationClause(organizations)} AND created >= -${days}d AND updated <= -${QUIET_MINUTES}m ORDER BY created DESC`;
}

// 53-bit string hash (cyrb53): enough to notice a change, not for security.
export function hash(text) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * A cheap fingerprint from the search result: changes when the summary,
 * description or any comment (public or internal) changes. Writing the summary
 * field doesn't change it, so the app's own edit doesn't trigger another run.
 */
export function sourceFingerprint(fields = {}) {
  const comments = Array.isArray(fields.comment?.comments) ? fields.comment.comments : [];
  return hash(JSON.stringify([fields.summary ?? '', fields.description ?? null, fields.comment?.total ?? comments.length, comments.map((c) => `${c.id}:${c.updated || c.created}`)]));
}

function adfText(node) {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'text') return String(node.text || '');
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'mention') return String(node.attrs?.text || '');
  const inner = (Array.isArray(node.content) ? node.content : []).map(adfText).join('');
  return ['paragraph', 'heading', 'listItem', 'codeBlock', 'blockquote'].includes(node.type) ? `${inner}\n` : inner;
}

// Where an email's own text ends: the quoted earlier thread, a mobile footer or a disclaimer.
const QUOTE_START = [
  /^On .{6,200} wrote:\s*$/i,
  /^-{2,}\s*(Original|Forwarded) Message\s*-{2,}/i,
  /^From:\s.+/i,
  /^Sent from my /i,
  /^Get Outlook for /i,
  /^(This (e-?mail|message)|The information (contained )?in this (e-?mail|message)|CONFIDENTIALITY NOTICE|DISCLAIMER)/i,
  /^_{8,}\s*$/,
];

/**
 * An email reply without the earlier thread quoted under it, footers and
 * disclaimers, so each comment sends only what's new. When less than
 * `minKeep` characters would remain (a forwarded email whose text is all
 * below "From:"), the text is kept whole.
 */
export function withoutQuoted(text, minKeep = 1) {
  const lines = String(text ?? '').split('\n');
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (QUOTE_START.some((re) => re.test(t))) break;
    if (t.startsWith('>')) continue;
    out.push(line);
  }
  const kept = out.join('\n').trim();
  return kept.length >= minKeep ? kept : String(text ?? '').trim();
}

export const plainText = (value) => (value && typeof value === 'object' ? adfText(value) : String(value ?? ''))
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

/**
 * What the model sees. publicComments come from the service desk request
 * comments API with public=true&internal=false: { body, created }.
 */
export function summaryInput(issue, publicComments = []) {
  const f = issue?.fields || {};
  const comments = publicComments
    .map((c) => ({ created: String(c?.created?.iso8601 || c?.created || '').slice(0, 10), text: clip(withoutQuoted(plainText(c?.body)), MAX_COMMENT) }))
    .filter((c) => c.text)
    .slice(-MAX_COMMENTS);
  return {
    title: clip(f.summary, 300),
    requestType: clip(f.customfield_10010?.requestType?.name, 120),
    status: clip(f.status?.name, 60),
    created: String(f.created || '').slice(0, 10),
    // A description is often a forwarded email: keep it whole unless real text stands above the quote.
    description: withoutQuoted(plainText(f.description), 120).slice(0, MAX_DESCRIPTION),
    comments,
  };
}

export const hasContent = (input) => Boolean(input.description || input.comments.length);

/** The value to write: a paragraph field takes a document, a single-line one plain text. */
export function fieldValue(summary, kind) {
  if (kind === 'textarea') return { type: 'doc', version: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: summary }] }] };
  return summary.length <= SHORT_TEXT ? summary : `${summary.slice(0, SHORT_TEXT - 1).replace(/\s+\S*$/, '')}…`;
}
