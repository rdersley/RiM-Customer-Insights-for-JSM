// App settings chosen by a Jira admin on the Customer Insights settings page.
// Nothing site-specific is hard-coded: breakdown fields are picked from the
// site's own Jira fields.

import { sanitizeHeadcounts } from './headcount.js';
import { DEFAULT_SURGE, sanitizeSurge } from './surge.js';
import { DEFAULT_HEALTH, sanitizeHealth } from './health.js';
import { DEFAULT_HIDDEN_SECTIONS, sanitizeHiddenSections } from './sections.js';
import { sanitizeDispatch } from './dispatch.js';
import { slaFieldList } from './sla.js';
import { DEFAULT_DEVICES, sanitizeDevices } from './devices.js';
import { sanitizeEscalation } from './escalation.js';
import { sanitizeChannelField } from './channels.js';
import { sanitizeWeekly } from './weekly.js';

export const MAX_BREAKDOWNS = 5;
// Fewest tickets (in the analysed sample) for a group to count as a pattern.
export const MIN_PATTERN = { min: 2, max: 10, default: 3 };
// Breakdown values that mean "nobody filled this in". Admins can change the list.
export const DEFAULT_PLACEHOLDERS = ['Unknown', 'Please update', 'Please select', 'N/A', 'None', 'Not set', 'TBC', 'TBD', '-'];
export const MAX_PLACEHOLDERS = 30;
// Words that mean the same thing in tickets, so they group together. The first
// word of each line is the one shown. Crew and customers often name a device
// by its make ("bluepad") in one ticket and its type ("pinpad") in the next.
export const DEFAULT_SYNONYMS = [
  ['pinpad', 'pin pad', 'bluepad', 'blue pad', 'card reader', 'card terminal', 'payment terminal', 'payment device'],
  ['sync', 'synchronisation', 'synchronization', 'synchronise', 'synchronize', 'synchronising', 'synchronizing'],
  ['login', 'log in', 'logon', 'log on', 'sign in', 'signin'],
];
export const SYNONYM_LIMITS = { groups: 40, words: 20, length: 40 };
// Internal reports (the Internal tab) group IT and support tickets, so their
// same-meaning words differ from the customer defaults.
export const DEFAULT_INTERNAL_SYNONYMS = [
  ['laptop', 'notebook', 'pc', 'computer', 'desktop'],
  ['login', 'log in', 'logon', 'log on', 'sign in', 'signin'],
  ['password', 'pwd', 'passcode'],
  ['mfa', '2fa', 'two factor', 'authenticator', 'multi factor'],
  ['vpn', 'remote access'],
  ['access', 'permission', 'permissions'],
];
// Spike alerts (src/alerts.js). Off until an admin turns them on; creating a
// Jira ticket per alert is a separate switch.
export const MAX_WATCHED = 25;
export const ALERT_LIMITS = { threshold: { min: 20, max: 500, default: 50 }, minTickets: { min: 3, max: 200, default: 5 } };
export const DEFAULT_ALERTS = {
  enabled: false,
  organizations: [],
  thresholdPercent: ALERT_LIMITS.threshold.default,
  minTickets: ALERT_LIMITS.minTickets.default,
  createIssue: false,
  projectKey: '',
  issueTypeName: 'Task',
  issueTypeId: '',
};
export const DEFAULT_SETTINGS = { breakdowns: [], internalBreakdowns: [], projectProfiles: [], channelField: null, devices: DEFAULT_DEVICES, handlingStatuses: [], slaFields: [], internalPatterns: { minPatternSize: MIN_PATTERN.default, synonyms: DEFAULT_INTERNAL_SYNONYMS, placeholders: DEFAULT_PLACEHOLDERS }, clientFields: [], headcounts: [], portalEnabled: false, minPatternSize: MIN_PATTERN.default, placeholders: DEFAULT_PLACEHOLDERS, synonyms: DEFAULT_SYNONYMS, alerts: DEFAULT_ALERTS, surge: DEFAULT_SURGE, health: DEFAULT_HEALTH, hiddenSections: DEFAULT_HIDDEN_SECTIONS, weekly: { reports: [] } };

const whole = (value, { min, max, default: fallback }) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

/**
 * Validates alert settings. `organizations` are the ones the admin can see
 * ({ id, name }); only those can be watched, and names come from Jira, not
 * the page. The issue type id is resolved on the server when saving.
 */
export function sanitizeAlerts(input, organizations = []) {
  const known = new Map(organizations.map((o) => [String(o.id), o]));
  const seen = new Set();
  const watched = (Array.isArray(input?.organizations) ? input.organizations : [])
    .map((o) => known.get(String(o?.id ?? o)))
    .filter((o) => o && !seen.has(o.id) && seen.add(o.id))
    .slice(0, MAX_WATCHED)
    .map(({ id, name }) => ({ id: String(id), name: String(name) }));
  const projectKey = String(input?.projectKey ?? '').trim().toUpperCase();
  return {
    enabled: input?.enabled === true,
    organizations: watched,
    thresholdPercent: whole(input?.thresholdPercent, ALERT_LIMITS.threshold),
    minTickets: whole(input?.minTickets, ALERT_LIMITS.minTickets),
    createIssue: input?.createIssue === true,
    projectKey: /^[A-Z][A-Z0-9_]{0,49}$/.test(projectKey) ? projectKey : '',
    issueTypeName: String(input?.issueTypeName ?? '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Task',
    issueTypeId: /^\d{1,18}$/.test(String(input?.issueTypeId ?? '')) ? String(input.issueTypeId) : '',
  };
}

/** Placeholder values from a list or comma/new-line separated text; trimmed, unique, bounded. */
export function placeholderList(input, fallback = DEFAULT_PLACEHOLDERS) {
  if (input === undefined || input === null) return fallback;
  const items = Array.isArray(input) ? input : String(input).split(/[,\n]/);
  const seen = new Set();
  return items
    .map((v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 60))
    .filter((v) => v && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase()))
    .slice(0, MAX_PLACEHOLDERS);
}

/**
 * Same-meaning word lists from arrays or text, one list per line: "pinpad =
 * bluepad, pin pad" (or just commas). Lists need two or more words; a word
 * already in an earlier list is skipped so each word means one thing.
 */
export function synonymList(input, fallback = DEFAULT_SYNONYMS) {
  if (input === undefined || input === null) return fallback;
  const lines = Array.isArray(input) ? input : String(input).split('\n');
  const used = new Set();
  const out = [];
  for (const line of lines) {
    const words = (Array.isArray(line) ? line : String(line ?? '').split(/[=,:;]/))
      .map((w) => String(w ?? '').replace(/\s+/g, ' ').trim().slice(0, SYNONYM_LIMITS.length))
      .filter((w) => /[a-z0-9]/i.test(w) && !used.has(w.toLowerCase()) && used.add(w.toLowerCase()))
      .slice(0, SYNONYM_LIMITS.words);
    if (words.length >= 2) out.push(words);
    if (out.length >= SYNONYM_LIMITS.groups) break;
  }
  return out;
}

/** The pattern settings for an analysis: the internal ones for the Internal tab. */
export function patternSettingsFor(settings, internal) {
  const source = internal ? { ...DEFAULT_SETTINGS.internalPatterns, ...settings?.internalPatterns } : settings || {};
  return { minPatternSize: source.minPatternSize, synonyms: source.synonyms, placeholders: source.placeholders };
}

export const MAX_PROJECT_PROFILES = 20;
const PROJECT_KEY = /^[A-Z][A-Z0-9_]{0,49}$/;

/** Internal pattern and data quality settings, with IT defaults. */
function internalPatternsOf(ip = {}) {
  return {
    minPatternSize: patternMinimum(ip?.minPatternSize),
    synonyms: synonymList(ip?.synonyms, DEFAULT_INTERNAL_SYNONYMS),
    placeholders: placeholderList(ip?.placeholders),
  };
}

/**
 * The settings an analysis uses. Customer analyses use the customer settings.
 * An internal one uses the project settings that every chosen project shares,
 * or the default internal settings (no projects chosen, projects without their
 * own settings, or projects with different ones).
 */
export function analysisConfig(settings, payload) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  if (payload?.scope !== 'internal') {
    // Customer reports have their own SLAs; settings saved before 1.26 shared the internal list.
    return { profile: null, breakdowns: s.breakdowns || [], clientFields: [], slaFields: s.customerSlaFields ?? s.slaFields ?? [], patterns: patternSettingsFor(s, false) };
  }
  const projects = (Array.isArray(payload?.projects) ? payload.projects : []).map((k) => String(k).toUpperCase());
  const owners = projects.map((k) => (s.projectProfiles || []).find((p) => p.projects.includes(k)) || null);
  const profile = projects.length && owners[0] && owners.every((p) => p === owners[0]) ? owners[0] : null;
  if (profile) {
    return { profile: { id: profile.id, name: profile.name }, breakdowns: profile.breakdowns, clientFields: profile.clientFields, slaFields: profile.slaFields, patterns: { ...profile.patterns }, escalation: profile.escalation?.enabled ? profile.escalation : null, dispatch: profile.dispatch?.enabled ? profile.dispatch : null };
  }
  const mixed = owners.some(Boolean);
  return { profile: null, mixed, breakdowns: s.internalBreakdowns || [], clientFields: s.clientFields || [], slaFields: s.slaFields || [], patterns: patternSettingsFor(s, true) };
}

/** Every client field in any internal settings (for the client picker). */
export const allClientFields = (settings) => {
  const seen = new Set();
  return [...(settings?.clientFields || []), ...(settings?.projectProfiles || []).flatMap((p) => p.clientFields || [])]
    .filter((f) => !seen.has(f.id) && seen.add(f.id));
};

/** A pattern minimum within range; anything else falls back to the default. */
export function patternMinimum(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= MIN_PATTERN.min && n <= MIN_PATTERN.max ? n : MIN_PATTERN.default;
}

const clip = (value, length) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, length);

/**
 * How a Jira field's value is read, or null when it can't be broken down
 * (free text, numbers, dates, users). Based on the field's schema from
 * GET /rest/api/3/field.
 */
export function fieldKind(field) {
  const schema = field?.schema || {};
  const custom = String(schema.custom || '');
  if (schema.type === 'option') return 'option'; // select list, radio buttons
  if (schema.type === 'option-with-child') return 'cascading';
  if (schema.type === 'array' && schema.items === 'option') return 'options'; // multi-select, checkboxes
  if (schema.type === 'array' && schema.items === 'component') return 'named';
  if (schema.type === 'array' && schema.items === 'string' && (field.id === 'labels' || custom.endsWith(':labels'))) return 'strings';
  if (['priority', 'issuetype', 'resolution'].includes(schema.type)) return 'named';
  if (schema.type === 'sd-customerrequesttype') return 'requestType';
  return null;
}

/** A field value as a list of display strings. */
export function readValues(value, kind) {
  if (value === null || value === undefined) return [];
  const one = (v) => clip(v?.value ?? v?.name ?? v, 80);
  switch (kind) {
    case 'option': return [one(value)].filter(Boolean);
    case 'cascading': return [value.child?.value ? `${one(value)} / ${clip(value.child.value, 80)}` : one(value)].filter(Boolean);
    case 'options':
    case 'named':
    case 'strings': return (Array.isArray(value) ? value : [value]).map(one).filter(Boolean);
    case 'requestType': return [clip(value?.requestType?.name, 80)].filter(Boolean);
    case 'organizations': return (Array.isArray(value) ? value : [value]).map((o) => clip(o?.name, 200)).filter(Boolean);
    default: return [];
  }
}

/** Fields an admin may pick from: id, name and kind, supported types only. */
export function selectableFields(fields) {
  return (Array.isArray(fields) ? fields : [])
    .map((f) => ({ id: String(f.id || ''), name: clip(f.name, 120), kind: fieldKind(f) }))
    .filter((f) => f.id && f.name && f.kind)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Validates settings from the admin page against the site's selectable fields. */
function breakdownList(input, byId, { portal = true } = {}) {
  const seen = new Set();
  return (Array.isArray(input) ? input : [])
    .map((b) => byId.get(String(b?.id)) && { ...byId.get(String(b.id)), label: clip(b.label, 40) || byId.get(String(b.id)).name, portal: portal && b.portal === true })
    .filter((b) => b && !seen.has(b.id) && seen.add(b.id))
    .slice(0, MAX_BREAKDOWNS);
}

export function sanitizeSettings(input, selectable, organizations = [], { slaChoices = [], idChoices = [] } = {}) {
  const byId = new Map(selectable.map((f) => [f.id, f]));
  const breakdowns = breakdownList(input?.breakdowns, byId);
  // Internal reports have their own breakdown fields (never on the portal).
  const internalBreakdowns = breakdownList(input?.internalBreakdowns, byId, { portal: false });
  // Internal reports have their own pattern and data quality settings.
  const internalPatterns = internalPatternsOf(input?.internalPatterns);
  // Settings for particular projects (IT Help, SD…); a project is in one set.
  const used = new Set();
  const projectProfiles = (Array.isArray(input?.projectProfiles) ? input.projectProfiles : [])
    .map((p) => {
      const name = clip(p?.name, 60);
      const projects = [...new Set((Array.isArray(p?.projects) ? p.projects : []).map((k) => clip(k, 50).toUpperCase()))]
        .filter((k) => PROJECT_KEY.test(k) && !used.has(k) && used.add(k)).slice(0, 50);
      if (!name || !projects.length) return null;
      return {
        id: /^[a-z0-9-]{4,40}$/.test(String(p?.id)) ? String(p.id) : `p-${projects[0].toLowerCase()}-${Math.random().toString(36).slice(2, 7)}`,
        name,
        projects,
        breakdowns: breakdownList(p?.breakdowns, byId, { portal: false }),
        clientFields: clientFieldList(p?.clientFields, selectable),
        slaFields: slaFieldList(p?.slaFields, slaChoices),
        patterns: internalPatternsOf(p?.patterns),
        // Escalation levels card (e.g. SD only).
        escalation: sanitizeEscalation(p?.escalation),
        // Hardware dispatch card (e.g. HW): time to send devices against a target.
        dispatch: sanitizeDispatch(p?.dispatch, selectable),
      };
    })
    .filter(Boolean)
    .slice(0, MAX_PROJECT_PROFILES);
  // Statuses that count as handling time (AHT); empty means "in progress" ones that aren't waiting.
  const handlingStatuses = [...new Set((Array.isArray(input?.handlingStatuses) ? input.handlingStatuses : String(input?.handlingStatuses ?? '').split(/[\n,]/))
    .map((n) => clip(n, 60)).filter(Boolean))].slice(0, 30);
  return { breakdowns, internalBreakdowns, internalPatterns, projectProfiles, handlingStatuses, channelField: sanitizeChannelField(input?.channelField, selectable), devices: sanitizeDevices(input?.devices, { idChoices, selectable }), slaFields: slaFieldList(input?.slaFields, slaChoices), customerSlaFields: slaFieldList(input?.customerSlaFields === undefined ? input?.slaFields : input.customerSlaFields, slaChoices), clientFields: clientFieldList(input?.clientFields, selectable), headcounts: sanitizeHeadcounts(input?.headcounts, organizations, breakdowns), portalEnabled: input?.portalEnabled === true, minPatternSize: patternMinimum(input?.minPatternSize), placeholders: placeholderList(input?.placeholders), synonyms: synonymList(input?.synonyms), alerts: sanitizeAlerts(input?.alerts, organizations), surge: sanitizeSurge(input?.surge, organizations, breakdowns, selectable), health: sanitizeHealth(input?.health, organizations), hiddenSections: sanitizeHiddenSections(input?.hiddenSections), weekly: sanitizeWeekly(input?.weekly, organizations, selectable) };
}

const quote = (v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const SYSTEM_JQL = { components: 'component', priority: 'priority', issuetype: 'issuetype', resolution: 'resolution', labels: 'labels', project: 'project' };
const cfOf = (id) => { const m = /^customfield_(\d+)$/.exec(String(id)); return m ? `cf[${m[1]}]` : null; };

/** JQL for tickets with no value in breakdown field `b`, or null when it can't be searched. */
export function jqlEmptyClause(b) {
  // Client: read from several fields (SD Client in one project, Client in others).
  if (b?.kind === 'client') { const parts = (b.fields || []).map((f) => cfOf(f.id)).filter(Boolean).map((cf) => `${cf} is EMPTY`); return parts.length ? parts.join(' AND ') : null; }
  const custom = /^customfield_(\d+)$/.exec(b?.id || '');
  const field = custom ? `cf[${custom[1]}]` : SYSTEM_JQL[b?.id];
  return field && !['requestType', 'organizations'].includes(b.kind) ? `${field} is EMPTY` : null;
}

/**
 * JQL that matches tickets with `value` in breakdown field `b`, or null when
 * the field can't be searched that way (JSM request type uses a different
 * value format in JQL).
 */
export function jqlClause(b, value) {
  if (!b || value === undefined || value === null || value === '') return null;
  // JSM organisations are searched by name with the organizations clause.
  if (b.kind === 'organizations') return `organizations = ${quote(value)}`;
  if (b.kind === 'client') { const parts = (b.fields || []).map((f) => cfOf(f.id)).filter(Boolean).map((cf) => `${cf} = ${quote(value)}`); return parts.length ? `(${parts.join(' OR ')})` : null; }
  const custom = /^customfield_(\d+)$/.exec(b.id);
  const field = custom ? `cf[${custom[1]}]` : SYSTEM_JQL[b.id];
  if (!field) return null;
  if (b.kind === 'cascading') {
    if (!custom) return null;
    const [parent, child] = String(value).split(' / ');
    return `${field} in cascadeOption(${quote(parent)}${child ? `, ${quote(child)}` : ''})`;
  }
  if (b.kind === 'requestType') return null;
  return `${field} = ${quote(value)}`;
}

/** Breakdown values of one Jira issue: { fieldId: [values] }. */
export function dimensionsOf(issue, breakdowns) {
  const dims = {};
  for (const b of breakdowns) {
    // A client breakdown reads whichever of its fields the ticket has.
    const read = b.kind === 'client'
      ? (b.fields || []).flatMap((f) => readValues(issue?.fields?.[f.id], f.kind))
      : readValues(issue?.fields?.[b.id], b.kind);
    // `only` keeps the values an analysis is about (the selected organisations).
    const values = b.only ? read.filter((v) => b.only.includes(v)) : read;
    if (values.length) dims[b.id] = [...new Set(values)];
  }
  return dims;
}

/** Jira fields a search must return for these breakdowns. */
export const breakdownFieldIds = (breakdowns) => [...new Set(breakdowns.flatMap((b) => (b.kind === 'client' ? (b.fields || []).map((f) => f.id) : [b.id])))];

export const MAX_CLIENT_FIELDS = 5;
const CLIENT_KINDS = ['option', 'options', 'cascading', 'strings'];

/** The admin's client fields (internal analysis), checked against the site's selectable fields. */
export function clientFieldList(input, selectable = []) {
  const byId = new Map(selectable.map((f) => [f.id, f]));
  const seen = new Set();
  return (Array.isArray(input) ? input : [])
    .map((x) => byId.get(String(x?.id ?? x)))
    .filter((f) => f && /^customfield_\d+$/.test(f.id) && CLIENT_KINDS.includes(f.kind) && !seen.has(f.id) && seen.add(f.id))
    .slice(0, MAX_CLIENT_FIELDS)
    .map((f) => ({ id: f.id, name: f.name, kind: f.kind }));
}

/**
 * Breakdowns added to an internal analysis: by project when it covers several
 * (or all), and by client (from any client field) unless it is one client.
 */
export function autoInternalBreakdowns(payload, clientFields = []) {
  const projects = Array.isArray(payload?.projects) ? payload.projects : [];
  const clients = Array.isArray(payload?.clients) ? payload.clients : [];
  const out = [];
  if (projects.length !== 1) out.push({ id: 'project', label: 'Project', kind: 'named', portal: false });
  if (clientFields.length && clients.length !== 1) out.push({ id: 'client', label: 'Client', kind: 'client', fields: clientFields, portal: false });
  return out;
}

const ORG_FIELD = 'com.atlassian.servicedesk:sd-customer-organizations';

/**
 * A breakdown by JSM organisation, for analyses that cover several of them:
 * found from the site's own Organizations field (GET /rest/api/3/field),
 * limited to the organisations selected. Null if the site has no such field.
 */
export function organisationBreakdown(fields, names) {
  const field = (Array.isArray(fields) ? fields : []).find((f) => String(f?.schema?.custom || '') === ORG_FIELD);
  return field ? { id: String(field.id), label: 'Organisation', kind: 'organizations', portal: false, only: names } : null;
}
