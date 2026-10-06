// App settings chosen by a Jira admin on the Customer Insights settings page.
// Nothing site-specific is hard-coded: breakdown fields are picked from the
// site's own Jira fields.

export const MAX_BREAKDOWNS = 5;
// Fewest tickets (in the analysed sample) for a group to count as a pattern.
export const MIN_PATTERN = { min: 2, max: 10, default: 3 };
// Breakdown values that mean "nobody filled this in". Admins can change the list.
export const DEFAULT_PLACEHOLDERS = ['Unknown', 'Please update', 'Please select', 'N/A', 'None', 'Not set', 'TBC', 'TBD', '-'];
export const MAX_PLACEHOLDERS = 30;
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
export const DEFAULT_SETTINGS = { breakdowns: [], portalEnabled: false, minPatternSize: MIN_PATTERN.default, placeholders: DEFAULT_PLACEHOLDERS, alerts: DEFAULT_ALERTS };

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
export function placeholderList(input) {
  if (input === undefined || input === null) return DEFAULT_PLACEHOLDERS;
  const items = Array.isArray(input) ? input : String(input).split(/[,\n]/);
  const seen = new Set();
  return items
    .map((v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 60))
    .filter((v) => v && !seen.has(v.toLowerCase()) && seen.add(v.toLowerCase()))
    .slice(0, MAX_PLACEHOLDERS);
}

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
export function sanitizeSettings(input, selectable, organizations = []) {
  const byId = new Map(selectable.map((f) => [f.id, f]));
  const seen = new Set();
  const breakdowns = (Array.isArray(input?.breakdowns) ? input.breakdowns : [])
    .map((b) => byId.get(String(b?.id)) && { ...byId.get(String(b.id)), label: clip(b.label, 40) || byId.get(String(b.id)).name, portal: b.portal === true })
    .filter((b) => b && !seen.has(b.id) && seen.add(b.id))
    .slice(0, MAX_BREAKDOWNS);
  return { breakdowns, portalEnabled: input?.portalEnabled === true, minPatternSize: patternMinimum(input?.minPatternSize), placeholders: placeholderList(input?.placeholders), alerts: sanitizeAlerts(input?.alerts, organizations) };
}

const quote = (v) => `"${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const SYSTEM_JQL = { components: 'component', priority: 'priority', issuetype: 'issuetype', resolution: 'resolution', labels: 'labels' };

/** JQL for tickets with no value in breakdown field `b`, or null when it can't be searched. */
export function jqlEmptyClause(b) {
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
    const read = readValues(issue?.fields?.[b.id], b.kind);
    // `only` keeps the values an analysis is about (the selected organisations).
    const values = b.only ? read.filter((v) => b.only.includes(v)) : read;
    if (values.length) dims[b.id] = [...new Set(values)];
  }
  return dims;
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
