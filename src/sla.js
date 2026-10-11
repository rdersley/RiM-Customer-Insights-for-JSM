// SLAs: whether each ticket met or breached the JSM SLAs an admin chose (for
// example "Time to resolution"), counted for the period, each recurring issue
// and each breakdown value, so reports show which issues and teams breach most.

export const MAX_SLA_FIELDS = 3;
export const SLA_FIELD = 'com.atlassian.servicedesk:sd-sla-field';
const MIN_FOR_RATE = 3; // tickets with the SLA before a rate is ranked

/**
 * 'met', 'breached' or null (no SLA on the ticket) from a JSM SLA field value.
 * A ticket breached if any cycle did, finished or still running. Values already
 * reduced to 'met' or 'breached' (full analysis) pass through.
 */
export function slaState(raw) {
  if (raw === 'met' || raw === 'breached') return raw;
  if (!raw || typeof raw !== 'object') return null;
  const cycles = [...(Array.isArray(raw.completedCycles) ? raw.completedCycles : []), ...(raw.ongoingCycle ? [raw.ongoingCycle] : [])];
  if (!cycles.length) return null;
  return cycles.some((c) => c?.breached === true) ? 'breached' : 'met';
}

/** Met and breached counts per SLA field: { fieldId: { met, breached } }. */
export function slaTally(issues, slaFields = []) {
  const out = {};
  for (const f of slaFields) {
    const t = { met: 0, breached: 0 };
    for (const issue of issues) {
      const state = slaState(issue?.fields?.[f.id]);
      if (state) t[state] += 1;
    }
    out[f.id] = t;
  }
  return out;
}

/** Adds two tallies (merged patterns). */
export function addTallies(a = {}, b = {}) {
  const out = { ...a };
  for (const [id, t] of Object.entries(b)) out[id] = { met: (out[id]?.met || 0) + t.met, breached: (out[id]?.breached || 0) + t.breached };
  return out;
}

const rate = (t) => (t && t.met + t.breached ? Math.round((t.breached / (t.met + t.breached)) * 100) : null);

/** Period totals per SLA, scaled like the ticket counts. */
export function slaSummary(current, slaFields, scale = 1) {
  const tally = slaTally(current, slaFields);
  return slaFields.map((f) => {
    const t = tally[f.id];
    return { id: f.id, name: f.name, met: Math.round(t.met * scale), breached: Math.round(t.breached * scale), breachedShare: rate(t), estimated: scale > 1 };
  }).filter((s) => s.met + s.breached > 0);
}

/**
 * For one SLA: recurring issues that breach most, and the breakdown values
 * with the highest breach rate (at least MIN_FOR_RATE tickets with the SLA).
 * Rates come from the analysed tickets, so they hold for sampled periods too.
 */
export function slaHotspots(report, groups, slaId, { top = 8 } = {}) {
  const issues = (groups || [])
    .map((g, index) => ({ index, ...(g.sla?.[slaId] || { met: 0, breached: 0 }) }))
    .filter((r) => r.met + r.breached >= MIN_FOR_RATE && r.breached > 0)
    .map((r) => ({ ...r, share: rate(r) }))
    .sort((a, b) => b.breached - a.breached || b.share - a.share)
    .slice(0, top);
  const breakdowns = (report?.breakdowns || []).map((b) => ({
    label: b.label,
    values: (b.values || [])
      .map((v) => ({ value: v.value, ...(v.sla?.[slaId] || { met: 0, breached: 0 }) }))
      .filter((v) => v.met + v.breached >= MIN_FOR_RATE)
      .map((v) => ({ ...v, share: rate(v) }))
      .sort((a, b) => b.share - a.share || b.breached - a.breached)
      .slice(0, 5),
  })).filter((b) => b.values.length);
  return { issues, breakdowns };
}

/** SLA fields an admin may choose, from GET /rest/api/3/field. */
export function slaFieldChoices(fields) {
  return (Array.isArray(fields) ? fields : [])
    .filter((f) => String(f?.schema?.custom || '') === SLA_FIELD && /^customfield_\d+$/.test(String(f.id)))
    .map((f) => ({ id: String(f.id), name: String(f.name).slice(0, 120) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The admin's SLA fields, checked against the site's SLA fields. */
export function slaFieldList(input, choices = []) {
  const byId = new Map(choices.map((f) => [f.id, f]));
  const seen = new Set();
  return (Array.isArray(input) ? input : [])
    .map((x) => byId.get(String(x?.id ?? x)))
    .filter((f) => f && !seen.has(f.id) && seen.add(f.id))
    .slice(0, MAX_SLA_FIELDS);
}
