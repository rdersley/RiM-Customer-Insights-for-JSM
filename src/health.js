// Customer health score: one 0–100 number per organisation (higher is
// healthier) from the signals a report already has. Each signal is scored
// 0–100 on its own; signals with too little data are left out and the rest are
// weighted again, so a site without SLAs or satisfaction still gets a score.
// Internal only: never on the portal or in PDFs and emails sent to customers.
import { ratingOf } from './agents.js';

export const HEALTH_SIGNALS = [
  { key: 'volume', label: 'Ticket volume', weight: 20 },
  { key: 'rising', label: 'Rising issues', weight: 20 },
  { key: 'sla', label: 'SLAs met', weight: 25 },
  { key: 'backlog', label: 'Aged backlog', weight: 20 },
  { key: 'satisfaction', label: 'Satisfaction', weight: 15 },
];
export const HEALTH_BANDS = [
  { min: 75, label: 'Healthy', kind: 'success' },
  { min: 50, label: 'Watch', kind: 'warning' },
  { min: 0, label: 'At risk', kind: 'danger' },
];
export const AGED_DAYS = 30; // open tickets older than this count as aged
export const MAX_HEALTH_ORGS = 50;
export const HEALTH_HISTORY_DAYS = 90;
const MIN_PREVIOUS = 10; // tickets in the previous period before volume change counts
const MIN_SLA = 5; // tickets with an SLA result
const MIN_RATED = 5; // satisfaction ratings
const MIN_OPEN = 5; // open tickets before the age of the backlog counts

const clamp = (n) => Math.max(0, Math.min(100, Math.round(n)));
/** Linear score: `good` or better is 100, `bad` or worse is 0. */
const between = (value, good, bad) => clamp(((value - bad) / (good - bad)) * 100);

export function bandOf(score) {
  if (score === null || score === undefined) return null;
  return HEALTH_BANDS.find((b) => score >= b.min);
}

/** A recurring issue is rising when it is new with 5+ tickets, or up 50% and by 3+ on the previous period. */
export function isRising(group) {
  const now = Number(group?.count) || 0;
  const before = Number(group?.previousCount) || 0;
  if (!before) return now >= 5;
  return now >= before * 1.5 && now - before >= 3;
}

/** Average 1–5 rating and how many tickets were rated, from the analysed tickets. */
export function satisfactionOf(issues, fieldId) {
  if (!fieldId) return null;
  const ratings = (issues || []).map((issue) => ratingOf(issue?.fields?.[fieldId])).filter((r) => r !== null);
  if (!ratings.length) return { average: null, rated: 0 };
  return { average: Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10, rated: ratings.length };
}

/** Open tickets and how many are older than AGED_DAYS, from the flow card's backlog ({ open, ages }). */
export function agedBacklog(backlog) {
  if (!backlog || !Number.isFinite(backlog.open)) return null;
  if (Number.isFinite(backlog.aged)) return { open: backlog.open, aged: backlog.aged };
  // flow.js bands: under 7, 7–30, 30–90, over 90 days.
  const aged = (backlog.ages || []).slice(2).reduce((n, b) => n + (b.count || 0), 0);
  return { open: backlog.open, aged };
}

/**
 * The health score for a report: { score, band, signals, weakest }.
 * `backlog` is { open, aged } or the flow card's { open, ages }; it is optional.
 * Needs at least two signals, otherwise score is null.
 */
export function healthOf(report, backlog = null) {
  const signals = [];
  const add = (key, score, value, detail) => {
    const s = HEALTH_SIGNALS.find((x) => x.key === key);
    signals.push({ key, label: s.label, weight: s.weight, score, value, detail });
  };
  const current = Number(report?.currentCount) || 0;
  const previous = Number(report?.previousCount) || 0;

  if (previous >= MIN_PREVIOUS) {
    const change = Math.round(((current - previous) / previous) * 100);
    // Fewer tickets is healthy; 50% more or worse scores 0.
    add('volume', between(change, 0, 50), change, `${change > 0 ? '+' : ''}${change}% on the previous period (${current.toLocaleString()} tickets)`);
  }

  if (current > 0 && Array.isArray(report?.groups)) {
    const rising = report.groups.filter(isRising);
    const share = Math.min(100, Math.round((rising.reduce((n, g) => n + (Number(g.count) || 0), 0) / current) * 100));
    add('rising', between(share, 0, 40), share, rising.length ? `${rising.length} rising or new ${rising.length === 1 ? 'issue' : 'issues'}, ${share}% of tickets` : 'No rising or new issues');
  }

  const sla = (report?.sla || []).reduce((t, s) => ({ met: t.met + s.met, breached: t.breached + s.breached }), { met: 0, breached: 0 });
  if (sla.met + sla.breached >= MIN_SLA) {
    const met = Math.round((sla.met / (sla.met + sla.breached)) * 100);
    add('sla', between(met, 95, 70), met, `${met}% met (${sla.breached.toLocaleString()} breached)`);
  }

  const aged = agedBacklog(backlog);
  if (aged && aged.open >= MIN_OPEN) {
    const share = Math.round((aged.aged / aged.open) * 100);
    add('backlog', between(share, 0, 50), share, `${share}% of ${aged.open.toLocaleString()} open tickets are over ${AGED_DAYS} days old`);
  } else if (aged) {
    add('backlog', 100, 0, `${aged.open} open ${aged.open === 1 ? 'ticket' : 'tickets'}`);
  }

  const csat = report?.satisfaction;
  if (csat?.average !== null && csat?.average !== undefined && csat.rated >= MIN_RATED) {
    add('satisfaction', between(csat.average, 4.5, 2), csat.average, `${csat.average} out of 5 from ${csat.rated} ${csat.rated === 1 ? 'rating' : 'ratings'}`);
  }

  if (signals.length < 2) return { score: null, band: null, signals, weakest: null };
  const weight = signals.reduce((n, s) => n + s.weight, 0);
  const score = clamp(signals.reduce((n, s) => n + s.score * s.weight, 0) / weight);
  for (const s of signals) s.share = Math.round((s.weight / weight) * 100);
  const weakest = [...signals].sort((a, b) => a.score - b.score)[0];
  return { score, band: bandOf(score), signals, weakest: weakest.score < 75 ? weakest.key : null };
}

/** Adds today's score to a history, one point per day, newest last, HEALTH_HISTORY_DAYS kept. */
export function addHistory(history, date, score) {
  const kept = (Array.isArray(history) ? history : []).filter((p) => p.date !== date);
  kept.push({ date, score });
  kept.sort((a, b) => a.date.localeCompare(b.date));
  return kept.slice(-HEALTH_HISTORY_DAYS);
}

/** Score change against the point closest to `days` ago (at least `days`), or null. */
export function changeOver(history, days = 7) {
  if (!Array.isArray(history) || history.length < 2) return null;
  const last = history[history.length - 1];
  const cutoff = new Date(Date.parse(`${last.date}T00:00:00Z`) - days * 86400000).toISOString().slice(0, 10);
  const earlier = [...history].reverse().find((p) => p.date <= cutoff && p.score !== null);
  return earlier && last.score !== null ? last.score - earlier.score : null;
}

/** Sanitised health settings: the organisations on the all-customers list. */
export function sanitizeHealth(input, organizations = []) {
  const known = new Map(organizations.map((o) => [String(o.id), o]));
  const seen = new Set();
  const list = (Array.isArray(input?.organizations) ? input.organizations : [])
    .map((o) => known.get(String(o?.id ?? o)))
    .filter((o) => o && !seen.has(String(o.id)) && seen.add(String(o.id)))
    .slice(0, MAX_HEALTH_ORGS)
    .map(({ id, name }) => ({ id: String(id), name: String(name) }));
  return { enabled: input?.enabled === true, organizations: list };
}
export const DEFAULT_HEALTH = { enabled: false, organizations: [] };
