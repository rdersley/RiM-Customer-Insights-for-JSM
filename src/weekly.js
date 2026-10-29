// Weekly SD report: last week's key metrics, top issues and workload for a set
// of organisations (for example Ryanair and Ryanair Crew), built once a week by
// a background job (src/weeklyJobs.js) and kept for 12 weeks. Agents add the
// insights, action register and progress notes, then publish a week to the
// portal. Weeks run Monday to Sunday in Irish time. Everything here is plain
// arithmetic on tickets already read from Jira.

export const WEEKLY_ZONE = 'Europe/Dublin';
export const MAX_WEEKLY_REPORTS = 5;
export const MAX_WEEKLY_ORGS = 10;
export const WEEKS_KEPT = 12;
export const NO_CATEGORY = 'No category';
export const NOTE_LIMITS = { text: 4000, actions: 30, action: 300, owner: 80, due: 40, status: 40 };
export const ACTION_STATUSES = ['Open', 'In progress', 'Done', 'On hold'];
const DAY = 86400000;
const HOUR = 3600000;

const clip = (value, length) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, length);
const round1 = (n) => Math.round(n * 10) / 10;
const pct = (part, whole) => (whole > 0 ? round1((part / whole) * 100) : null);
const change = (now, before) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);

// ---- Weeks in Irish time -------------------------------------------------------

/** The zone's offset from UTC (ms) at instant `ms`. */
export function zoneOffset(ms, zone = WEEKLY_ZONE) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** The instant (ms) a date (YYYY-MM-DD) starts in the zone. */
export function zoneMidnight(iso, zone = WEEKLY_ZONE) {
  const guess = Date.parse(`${iso}T00:00:00Z`);
  const first = guess - zoneOffset(guess, zone);
  // Second pass for dates whose offset differs from the guess's (clock changes).
  return guess - zoneOffset(first, zone);
}

/** A date (YYYY-MM-DD) in the zone at instant `ms`. */
export function zoneDate(ms, zone = WEEKLY_ZONE) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

const addDays = (iso, n) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** The week (Monday to Sunday) starting on Monday `from`, with its start and end instants. */
export function weekOf(from, zone = WEEKLY_ZONE) {
  return { from, to: addDays(from, 6), start: zoneMidnight(from, zone), end: zoneMidnight(addDays(from, 7), zone) };
}

/** The latest whole week before `now`: last Monday to Sunday. */
export function lastWeek(now = Date.now(), zone = WEEKLY_ZONE) {
  const today = zoneDate(now, zone);
  const weekday = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday 0
  return weekOf(addDays(today, -weekday - 7), zone);
}

export const previousWeek = (week, zone = WEEKLY_ZONE) => weekOf(addDays(week.from, -7), zone);
export const isMonday = (iso) => /^\d{4}-\d{2}-\d{2}$/.test(String(iso)) && new Date(`${iso}T00:00:00Z`).getUTCDay() === 1;

/** "19–25 October 2026", for headings and file names. */
export function weekLabel(week) {
  const f = new Date(`${week.from}T00:00:00Z`);
  const t = new Date(`${week.to}T00:00:00Z`);
  const month = (d) => d.toLocaleDateString('en-GB', { month: 'long', timeZone: 'UTC' });
  const head = f.getUTCMonth() === t.getUTCMonth() ? `${f.getUTCDate()}` : `${f.getUTCDate()} ${month(f)}${f.getUTCFullYear() === t.getUTCFullYear() ? '' : ` ${f.getUTCFullYear()}`}`;
  return `${head}–${t.getUTCDate()} ${month(t)} ${t.getUTCFullYear()}`;
}

// ---- Settings ------------------------------------------------------------------

const FIELD_KINDS = ['option', 'cascading', 'options', 'named', 'strings', 'requestType'];
const fieldFrom = (input, byId) => {
  const f = byId.get(String(input?.id ?? input ?? ''));
  return f && FIELD_KINDS.includes(f.kind) ? { id: f.id, name: f.name, kind: f.kind } : null;
};

/**
 * Settings → Weekly report: up to 5 reports, each covering up to 10 of the
 * site's organisations (`organizations` is the list the admin can see), with
 * the category and optional subcategory fields from the site's fields.
 */
export function sanitizeWeekly(input, organizations = [], selectable = []) {
  const orgById = new Map(organizations.map((o) => [String(o.id), o]));
  const fieldById = new Map(selectable.map((f) => [f.id, f]));
  const reports = (Array.isArray(input?.reports) ? input.reports : []).map((r) => {
    const seen = new Set();
    const orgs = (Array.isArray(r?.organizations) ? r.organizations : [])
      .map((o) => orgById.get(String(o?.id)))
      .filter((o) => o && !seen.has(o.id) && seen.add(o.id))
      .slice(0, MAX_WEEKLY_ORGS)
      .map((o) => ({ id: String(o.id), name: o.name }));
    const name = clip(r?.name, 60);
    if (!name || !orgs.length) return null;
    const projects = [...new Set((Array.isArray(r?.projects) ? r.projects : String(r?.projects ?? '').split(/[\s,]+/))
      .map((k) => clip(k, 50).toUpperCase()).filter((k) => /^[A-Z][A-Z0-9_]{0,49}$/.test(k)))].slice(0, 10);
    const categoryField = fieldFrom(r?.categoryField, fieldById);
    const subcategoryField = fieldFrom(r?.subcategoryField, fieldById);
    return {
      id: /^w-[a-z0-9-]{3,40}$/.test(String(r?.id)) ? String(r.id) : `w-${Math.random().toString(36).slice(2, 9)}`,
      name,
      organizations: orgs,
      projects,
      categoryField,
      // A cascading category already holds its subcategory.
      subcategoryField: subcategoryField && subcategoryField.id !== categoryField?.id ? subcategoryField : null,
      portal: r?.portal === true,
      // Insights and suggested actions written by AI at each build (src/weeklyAi.js).
      aiNotes: r?.aiNotes !== false,
    };
  }).filter(Boolean).slice(0, MAX_WEEKLY_REPORTS);
  return { reports };
}

/** The agent's notes for a week: insights, action register and progress. */
export function sanitizeNotes(input) {
  const text = (v) => String(v ?? '').replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, NOTE_LIMITS.text);
  const actions = (Array.isArray(input?.actions) ? input.actions : []).map((a) => ({
    action: clip(a?.action, NOTE_LIMITS.action),
    owner: clip(a?.owner, NOTE_LIMITS.owner),
    due: clip(a?.due, NOTE_LIMITS.due),
    status: ACTION_STATUSES.includes(a?.status) ? a.status : 'Open',
    // Where a suggested action came from (src/weeklyAi.js); agents' own have none.
    ...(['ai', 'carried'].includes(a?.source) ? { source: a.source } : {}),
  })).filter((a) => a.action).slice(0, NOTE_LIMITS.actions);
  return { insights: text(input?.insights), actions, completed: text(input?.completed), inProgress: text(input?.inProgress), nextSteps: text(input?.nextSteps) };
}

export const EMPTY_NOTES = sanitizeNotes({});

/** Note text as bullet lines (one per line, list markers dropped). */
export const noteLines = (text) => String(text || '').split('\n').map((l) => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean);

// ---- The report ----------------------------------------------------------------

/**
 * A ticket reduced to what the report needs. `fields` is the Jira issue's
 * fields; `orgFieldId` the site's Organizations field; `values(field)` reads a
 * configured field's display values (settings.readValues).
 */
export function weeklyTicket(issue, { orgFieldId, categoryField, subcategoryField, readValues }) {
  const f = issue?.fields || {};
  const first = (field) => (field ? readValues(f[field.id], field.kind)[0] || null : null);
  let category = first(categoryField);
  let subcategory = first(subcategoryField);
  if (categoryField?.kind === 'cascading' && category) {
    const [parent, child] = category.split(' / ');
    category = parent;
    if (!subcategoryField) subcategory = child || null;
  }
  const resolved = Date.parse(f.resolutiondate);
  return {
    id: String(issue?.id ?? ''),
    key: String(issue?.key ?? ''),
    created: Date.parse(f.created),
    resolved: Number.isFinite(resolved) ? resolved : null,
    orgs: orgFieldId ? (Array.isArray(f[orgFieldId]) ? f[orgFieldId] : []).map((o) => String(o?.name ?? '')).filter(Boolean) : [],
    category: category || NO_CATEGORY,
    subcategory: subcategory || null,
    logged: Number(f.timespent) > 0 ? Number(f.timespent) : 0,
  };
}

/** Status changes and reassignments in a ticket's history, within its life. */
export function stepsOf(histories = []) {
  let statusChanges = 0;
  let reassignments = 0;
  for (const h of histories) {
    for (const item of h.items || []) {
      const field = item.fieldId || item.field;
      if (field === 'status') statusChanges += 1;
      else if (field === 'assignee' && item.from) reassignments += 1; // first assignment isn't a hand-off
    }
  }
  return { statusChanges, reassignments };
}

const inWeek = (ms, week) => ms !== null && ms >= week.start && ms < week.end;

/**
 * Backlog and activity for one scope: tickets created and resolved in the
 * week and the week before, and the open backlog at the start and end of each
 * week. Open counts come from `openNow` (tickets with no resolution, counted by
 * Jira) wound back: open at time t = open now − created since t and still open
 * + created before t and resolved since t.
 */
export function activityOf(tickets, openNow, week, before) {
  const openAt = (t) => (openNow === null ? null : Math.max(0,
    openNow - tickets.filter((x) => x.created >= t && x.resolved === null).length + tickets.filter((x) => x.created < t && x.resolved !== null && x.resolved >= t).length));
  const side = (w) => {
    const created = tickets.filter((x) => inWeek(x.created, w)).length;
    const resolved = tickets.filter((x) => inWeek(x.resolved, w)).length;
    const openStart = openAt(w.start);
    // % resolved: resolved ÷ (open at the start + created), the share of the week's workload cleared.
    const resolvedPct = openStart === null ? null : pct(resolved, openStart + created);
    return { created, resolved, openStart, openEnd: openAt(w.end), resolvedPct };
  };
  const now = side(week);
  const prev = side(before);
  return {
    ...now,
    previous: prev,
    createdChange: change(now.created, prev.created),
    resolvedChange: change(now.resolved, prev.resolved),
    resolvedPctChange: now.resolvedPct === null || prev.resolvedPct === null ? null : round1(now.resolvedPct - prev.resolvedPct),
  };
}

/** Counts by a key for tickets created in a week, largest first, with the week before. */
function breakdown(tickets, key, week, before) {
  const rows = new Map();
  for (const t of tickets) {
    const name = key(t);
    if (!name) continue;
    const row = rows.get(name) || { name, count: 0, previous: 0 };
    if (inWeek(t.created, week)) row.count += 1;
    else if (inWeek(t.created, before)) row.previous += 1;
    else continue;
    rows.set(name, row);
  }
  const total = [...rows.values()].reduce((n, r) => n + r.count, 0);
  return [...rows.values()]
    .filter((r) => r.count || r.previous)
    .map((r) => ({ ...r, share: pct(r.count, total) ?? 0, change: r.count - r.previous }))
    .sort((a, b) => b.count - a.count || b.previous - a.previous || a.name.localeCompare(b.name));
}

/**
 * Workload: for tickets resolved in the week, per category, the handling time
 * (time in handling statuses, from status history), status changes and
 * reassignments, and logged work. `effort` maps ticket id → { handlingMs,
 * statusChanges, reassignments }; tickets without an entry count as unread.
 */
export function workloadOf(tickets, effort, week, before) {
  const sum = (list) => {
    const read = list.filter((t) => effort[t.id]);
    const handlingMs = read.reduce((n, t) => n + (effort[t.id].handlingMs || 0), 0);
    return {
      resolved: list.length,
      read: read.length,
      handlingHours: round1(handlingMs / HOUR),
      avgHandlingMinutes: read.length ? Math.round(handlingMs / 60000 / read.length) : null,
      statusChangesPerTicket: read.length ? round1(read.reduce((n, t) => n + effort[t.id].statusChanges, 0) / read.length) : null,
      reassignmentsPerTicket: read.length ? round1(read.reduce((n, t) => n + effort[t.id].reassignments, 0) / read.length) : null,
      loggedHours: round1(list.reduce((n, t) => n + t.logged, 0) / 3600),
    };
  };
  const resolvedIn = (w) => tickets.filter((t) => inWeek(t.resolved, w));
  const current = resolvedIn(week);
  const totals = sum(current);
  const groups = new Map();
  for (const t of current) groups.set(t.category, [...(groups.get(t.category) || []), t]);
  const rows = [...groups.entries()].map(([name, list]) => {
    const row = sum(list);
    return { name, ...row, share: totals.handlingHours ? pct(row.handlingHours, totals.handlingHours) : 0 };
  }).sort((a, b) => b.handlingHours - a.handlingHours || b.resolved - a.resolved);
  return { totals, previous: sum(resolvedIn(before)), rows, complete: totals.read === totals.resolved };
}

/**
 * The week's report. `tickets` are weeklyTicket()s created or resolved since
 * the start of the week before; `openNow` is { all, byOrg: { name: n } }.
 */
export function weeklyReport({ config, week, tickets, openNow, effort = {}, builtAt = new Date().toISOString(), handlingStatuses = [] }) {
  const before = previousWeek(week);
  const orgNames = config.organizations.map((o) => o.name);
  const categories = breakdown(tickets, (t) => t.category, week, before);
  const biggest = categories.find((c) => c.name !== NO_CATEGORY && c.count) || null;
  const subcategories = biggest && (config.subcategoryField || config.categoryField?.kind === 'cascading')
    ? breakdown(tickets.filter((t) => t.category === biggest.name), (t) => t.subcategory || 'No subcategory', week, before)
    : null;
  return {
    id: config.id,
    name: config.name,
    week: { from: week.from, to: week.to },
    previousWeek: { from: before.from, to: before.to },
    timeZone: WEEKLY_ZONE,
    builtAt,
    organizations: config.organizations,
    fields: { category: config.categoryField?.name || null, subcategory: config.subcategoryField?.name || (config.categoryField?.kind === 'cascading' ? `${config.categoryField.name} (second level)` : null) },
    activity: {
      all: activityOf(tickets, openNow.all ?? null, week, before),
      // Per organisation only when the report covers more than one.
      byOrg: orgNames.length > 1 ? config.organizations.map((o) => ({ organization: o, ...activityOf(tickets.filter((t) => t.orgs.includes(o.name)), openNow.byOrg?.[o.name] ?? null, week, before) })) : [],
    },
    categories: config.categoryField ? categories : null,
    subcategories: subcategories ? { category: biggest.name, rows: subcategories } : null,
    workload: { ...workloadOf(tickets, effort, week, before), handlingStatuses: handlingStatuses.length ? handlingStatuses : null },
  };
}

/** Change text for a number: "+12%", "−3 pts", "–" when there's nothing to compare. */
export function changeText(value, unit = '%') {
  if (value === null || value === undefined) return '–';
  if (value === 0) return unit === '%' ? '0%' : `0${unit}`;
  return `${value > 0 ? '+' : '−'}${Math.abs(value)}${unit}`;
}
