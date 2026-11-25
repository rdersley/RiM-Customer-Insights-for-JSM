// Ticket lists for the Weekly SD report's Excel workbook (src/weeklyExcel.js):
// every ticket open at the end of the week, and every ticket created in it,
// one page at a time, read from Jira as the app when someone downloads. The
// columns follow the Ryanair weekly workbook; a named field the site doesn't
// have is left out. Nothing here is stored.
import { asApp, route } from '@forge/api';
import { readJson, requestWithRetry } from './engine.js';
import { plainText } from './ticketSummary.js';
import { zoneOffset } from './weekly.js';
import { scopeJql } from './weeklyJobs.js';

export const ROW_PAGE = 100;
const DAY = 86400000;
const FIELDS_FOR_MS = 5 * 60000;

// Columns in order. `system`: a Jira field read directly; `name`: a field found
// by its name on the site; `category`: the report's category field (whole,
// first level, second level); `age` and `overview` are worked out.
export const LIST_COLUMNS = [
  { label: 'Key', system: 'key', width: 12 },
  { label: 'Summary', system: 'summary', width: 50 },
  { label: 'Status', system: 'status', width: 24 },
  { label: 'Created', system: 'created', type: 'datetime', width: 17 },
  { label: 'Reporter', system: 'reporter', width: 24 },
  { label: 'Crew Code/Reporter:', name: 'Crew Code/Reporter:', width: 16 },
  { label: 'Base or Location', name: 'Base or Location', width: 14 },
  { label: 'Priority', system: 'priority', width: 9 },
  { label: 'SD Client', name: 'SD Client', width: 16 },
  { category: 'whole', width: 36 },
  { category: 'parent', width: 28 },
  { category: 'child', width: 26 },
  { label: 'Ticket Category', name: 'Ticket Category', width: 15 },
  { label: 'Device ID', name: 'Device ID', width: 16 },
  { label: 'Issue Received By', name: 'Issue Received By', width: 16 },
  { label: 'Device Type', name: 'Device Type', width: 18 },
  { label: 'Device Type / Fault', name: 'Device Type / Fault', width: 22 },
  { label: 'Tracking Number', name: 'Tracking Number', width: 18 },
  { label: 'Date Sent', name: 'Date Sent', width: 12 },
  { label: 'Resolution', system: 'resolution', width: 16 },
  { label: 'Resolved', system: 'resolutiondate', type: 'datetime', width: 17 },
  { label: 'Solution Type', name: 'Solution Type', width: 36 },
  { label: 'Date Delivered', name: 'Date Delivered', width: 13 },
  { label: 'Signed for by:', name: 'Signed for by:', width: 16 },
  { label: 'Age (days)', age: true, type: 'number', width: 10 },
  { label: 'Ticket overview', overview: true, width: 90 },
];

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/**
 * The columns for this site: named fields resolved to ids (every field with
 * that name; the first with a value wins), the category columns from the
 * report's category field, the overview from the AI ticket summary field.
 */
export function listColumns(fieldList, { categoryField = null, overviewFieldId = null } = {}) {
  const byName = new Map();
  for (const f of Array.isArray(fieldList) ? fieldList : []) {
    const key = norm(f?.name);
    if (key) byName.set(key, [...(byName.get(key) || []), f]);
  }
  const dateType = (list) => (list.every((f) => f.schema?.type === 'date') ? 'date' : list.every((f) => f.schema?.type === 'datetime') ? 'datetime' : 'text');
  return LIST_COLUMNS.flatMap((c) => {
    if (c.category) {
      if (!categoryField) return [];
      const label = { whole: categoryField.name, parent: `${categoryField.name} (parent)`, child: `${categoryField.name} (child)` }[c.category];
      // A one-level field has nothing to split.
      if (c.category !== 'whole' && categoryField.kind !== 'cascading') return [];
      return [{ label, category: c.category, ids: [categoryField.id], type: 'text', width: c.width }];
    }
    if (c.overview) return overviewFieldId ? [{ label: c.label, overview: true, ids: [overviewFieldId], type: 'text', width: c.width }] : [];
    if (c.name) {
      const list = byName.get(norm(c.name)) || [];
      return list.length ? [{ label: c.label, ids: list.map((f) => String(f.id)), type: dateType(list), width: c.width }] : [];
    }
    return [{ label: c.label, system: c.system, age: c.age, ids: c.system && c.system !== 'key' ? [c.system] : [], type: c.type || 'text', width: c.width }];
  });
}

/** A field value as text: options, cascading "Parent - Child", users, documents, lists. */
export function display(value) {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.map(display).filter(Boolean).join(', ');
  if (typeof value === 'object') {
    if (value.type === 'doc') return plainText(value);
    const own = String(value.displayName ?? value.value ?? value.name ?? value.key ?? '');
    return value.child ? `${own} - ${display(value.child)}` : own;
  }
  return String(value);
}

/** An instant as an Excel date number in Irish time; a plain date (YYYY-MM-DD) as that day. */
export function excelDate(value, type) {
  if (!value) return null;
  if (type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) return Date.parse(`${value}T00:00:00Z`) / DAY + 25569;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return (ms + zoneOffset(ms)) / DAY + 25569;
}

/** One ticket as a row of cells, with its first-level category for the focus sheets. */
export function rowOf(issue, columns, now = Date.now()) {
  const f = issue?.fields || {};
  const first = (ids) => ids.map((id) => f[id]).find((v) => v !== null && v !== undefined && display(v) !== '');
  const cat = columns.find((c) => c.category)?.ids[0];
  const catValue = cat ? f[cat] : null;
  const parent = String(catValue?.value ?? display(catValue)).trim();
  const cells = columns.map((c) => {
    if (c.system === 'key') return String(issue?.key ?? '');
    if (c.age) {
      const created = Date.parse(f.created);
      const until = Date.parse(f.resolutiondate);
      return Number.isFinite(created) ? Math.max(0, Math.floor(((Number.isFinite(until) ? until : now) - created) / DAY)) : null;
    }
    if (c.category === 'parent') return String(catValue?.value ?? '').trim();
    if (c.category === 'child') return String(catValue?.child?.value ?? '').trim();
    const value = first(c.ids);
    if (c.type === 'date' || c.type === 'datetime') return excelDate(value, c.type);
    return display(value).slice(0, 32000);
  });
  return { cells, category: parent };
}

/**
 * The JQL for a list, a day wider each side (JQL dates are in the site's time
 * zone): 'open' = open at the end of the week, 'created' = created in it.
 * Rows are then kept by the exact instants.
 */
export function listJql(config, week, list) {
  const scope = scopeJql(config);
  if (list === 'open') return `${scope} AND created < "${addDays(week.to, 2)}" AND (resolution = Unresolved OR resolved >= "${week.to}") ORDER BY created DESC`;
  return `${scope} AND created >= "${addDays(week.from, -1)}" AND created < "${addDays(week.to, 2)}" ORDER BY created DESC`;
}

export function keepRow(issue, week, list) {
  const created = Date.parse(issue?.fields?.created);
  if (list === 'created') return created >= week.start && created < week.end;
  const resolved = Date.parse(issue?.fields?.resolutiondate);
  return created < week.end && (!Number.isFinite(resolved) || resolved >= week.end);
}

let fieldCache = { at: 0, list: null };
async function siteFields() {
  if (fieldCache.list && Date.now() - fieldCache.at < FIELDS_FOR_MS) return fieldCache.list;
  const list = await readJson(await requestWithRetry(() => asApp().requestJira(route`/rest/api/3/field`, { headers: { Accept: 'application/json' } })), 'Field list');
  fieldCache = { at: Date.now(), list };
  return list;
}

/** One page of a list: { columns, rows, nextPageToken }. */
export async function ticketRows(config, week, list, { nextPageToken = '', overviewFieldId = null } = {}) {
  if (!['open', 'created'].includes(list)) throw new Error('Unknown ticket list.');
  const columns = listColumns(await siteFields(), { categoryField: config.categoryField, overviewFieldId });
  const fields = [...new Set(['created', 'resolutiondate', ...columns.flatMap((c) => c.ids)])];
  const body = { jql: listJql(config, week, list), maxResults: ROW_PAGE, fields, ...(nextPageToken ? { nextPageToken } : {}) };
  const page = await readJson(await requestWithRetry(() => asApp().requestJira(route`/rest/api/3/search/jql`, {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })), 'Ticket search');
  const now = Date.now();
  return {
    columns: columns.map(({ label, type, width }) => ({ label, type, width })),
    rows: (page.issues || []).filter((issue) => keepRow(issue, week, list)).map((issue) => rowOf(issue, columns, now)),
    nextPageToken: page.nextPageToken || '',
  };
}
