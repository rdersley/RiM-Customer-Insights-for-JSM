// Crew numbers per organisation and base, so tickets can be compared with the
// number of people raising them: "tickets per 100 crew". A Jira admin uploads
// the customer's crew list on the settings page. It is read in the browser and
// only the number of crew per base is kept; names, emails and other personal
// details never leave the admin's computer.

export const MAX_HEADCOUNTS = 25; // organisations
export const MAX_HEADCOUNT_VALUES = 300; // bases per organisation
const MAX_CREW = 10000000;
const ORG_ID = /^\d{1,18}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const clip = (value, length) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, length);
const norm = (value) => clip(value, 80).toLowerCase();

/** Rows of a CSV file (quoted cells, commas, semicolons or tabs). */
export function csvRows(text) {
  const source = String(text ?? '').replace(/^﻿/, '');
  const firstLine = source.split(/\r?\n/, 1)[0];
  const sep = [',', ';', '\t'].sort((a, b) => firstLine.split(b).length - firstLine.split(a).length)[0];
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const c = source[i];
    if (quoted) {
      if (c === '"' && source[i + 1] === '"') { cell += '"'; i += 1; } else if (c === '"') quoted = false; else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && source[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim()));
}

// "2026-10-09 00:00:00", "2026-10-09" or "09/10/2026" (day first) as 2026-10-09.
function isoDate(value) {
  const s = String(value ?? '').trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{4})/.exec(s);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : '';
}

/**
 * Crew per base from a file. Either a crew list with one row per person and a
 * Base column (people who have left, or are not at that base today, are
 * skipped when the file has EmploymentEndDate / BaseDateFrom / BaseDateTo), or
 * a short list of "base, number" lines. Returns counts only.
 */
export function crewFromFile(text, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const rows = csvRows(text);
  if (!rows.length) throw new Error('The file is empty.');
  const header = rows[0].map((h) => h.trim().toLowerCase().replace(/[^a-z]/g, ''));
  const base = header.findIndex((h) => h === 'base' || h === 'basecode' || h === 'homebase' || h === 'location');
  const counts = new Map();
  const add = (value, n) => {
    const name = clip(value, 80);
    if (!name || !(n > 0)) return;
    const key = name.toUpperCase();
    counts.set(key, { value: counts.get(key)?.value || name, count: (counts.get(key)?.count || 0) + n });
  };
  let people = 0;
  let skipped = 0;
  const twoColumns = rows.every((r) => r.length <= 3) && rows.slice(1).every((r) => /^\s*\d[\d,\s]*$/.test(r[1] ?? ''));
  if (base >= 0 && !twoColumns) {
    const ended = header.indexOf('employmentenddate');
    const from = header.indexOf('basedatefrom');
    const to = header.indexOf('basedateto');
    for (const r of rows.slice(1)) {
      const end = ended >= 0 ? isoDate(r[ended]) : '';
      const start = from >= 0 ? isoDate(r[from]) : '';
      const until = to >= 0 ? isoDate(r[to]) : '';
      if ((end && end < today) || (start && start > today) || (until && until < today)) { skipped += 1; continue; }
      people += 1;
      add(r[base], 1);
    }
  } else {
    // "STN, 1194" lines, with or without a header row.
    for (const r of rows) {
      const n = Number(String(r[1] ?? '').replace(/[,\s]/g, ''));
      if (Number.isInteger(n)) { add(r[0], n); people += n; }
    }
  }
  if (!counts.size) throw new Error('No bases found. Use a crew list with a Base column, or lines of "base, number of crew".');
  const values = [...counts.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  return { values, total: values.reduce((n, v) => n + v.count, 0), people, skipped };
}

/** Validates the admin's crew numbers against organisations and breakdown fields they can use. */
export function sanitizeHeadcounts(input, organizations = [], breakdowns = []) {
  const orgs = new Map(organizations.map((o) => [String(o.id), o]));
  const fields = new Set(breakdowns.map((b) => b.id));
  const seen = new Set();
  return (Array.isArray(input) ? input : [])
    .map((h) => {
      const org = orgs.get(String(h?.organization?.id));
      if (!org || !ORG_ID.test(String(org.id)) || seen.has(String(org.id))) return null;
      if (!fields.has(String(h?.fieldId))) return null;
      seen.add(String(org.id));
      const values = new Map();
      for (const v of (Array.isArray(h?.values) ? h.values : [])) {
        const value = clip(v?.value, 80);
        const count = Number(v?.count);
        if (value && Number.isInteger(count) && count > 0 && count <= MAX_CREW && !values.has(value.toUpperCase())) values.set(value.toUpperCase(), { value, count });
      }
      const list = [...values.values()].sort((a, b) => b.count - a.count).slice(0, MAX_HEADCOUNT_VALUES);
      if (!list.length) return null;
      return {
        organization: { id: String(org.id), name: String(org.name) },
        fieldId: String(h.fieldId),
        values: list,
        updatedAt: ISO_TIME.test(String(h?.updatedAt)) ? String(h.updatedAt) : new Date().toISOString(),
        source: clip(h?.source, 120),
        portal: h?.portal === true,
      };
    })
    .filter(Boolean)
    .slice(0, MAX_HEADCOUNTS);
}

const per100 = (tickets, crew) => (crew > 0 ? Math.round((tickets / crew) * 1000) / 10 : null);

/**
 * Tickets per 100 crew for a report: overall, and per base from the report's
 * breakdown by `headcount.fieldId`. Bases are ranked by rate; `ratio` compares
 * a base with the average of all bases that have crew numbers. Bases with very
 * few crew are marked `small`, as a few tickets swing their rate.
 */
export function crewRates(report, headcount, { smallBase = 25 } = {}) {
  if (!report || !headcount?.values?.length) return null;
  const breakdown = (report.breakdowns || []).find((b) => b.id === headcount.fieldId);
  if (!breakdown) return null;
  const counts = new Map((breakdown.all || breakdown.values.map((v) => [v.value, v.count, v.previousCount])).map(([value, count, previous]) => [norm(value), { value, count, previous }]));
  const crew = headcount.values.reduce((n, v) => n + v.count, 0);
  const matched = new Set();
  const bases = headcount.values.map((h) => {
    const found = counts.get(norm(h.value));
    if (found) matched.add(norm(h.value));
    const tickets = found?.count || 0;
    const previous = found?.previous || 0;
    return { value: h.value, crew: h.count, tickets, previous, rate: per100(tickets, h.count), previousRate: per100(previous, h.count), small: h.count < smallBase };
  });
  const atBases = bases.reduce((n, b) => n + b.tickets, 0);
  const average = per100(atBases, crew);
  for (const b of bases) b.ratio = average ? Math.round((b.rate / average) * 10) / 10 : null;
  bases.sort((a, b) => b.rate - a.rate || b.tickets - a.tickets);
  const unmatched = [...counts.entries()].filter(([key]) => !matched.has(key)).map(([, v]) => ({ value: v.value, tickets: v.count })).sort((a, b) => b.tickets - a.tickets);
  return {
    field: breakdown.label,
    crew,
    tickets: report.currentCount,
    previous: report.previousCount,
    rate: report.filter ? null : per100(report.currentCount, crew), // a drill-down covers only some tickets
    previousRate: report.filter ? null : per100(report.previousCount, crew),
    average,
    bases,
    unmatched: unmatched.slice(0, 20),
    unmatchedTickets: unmatched.reduce((n, v) => n + v.tickets, 0),
    withoutValue: breakdown.withoutValue || 0,
    estimated: Boolean(breakdown.estimated),
    updatedAt: headcount.updatedAt,
  };
}
