// Devices affected: how many distinct devices (by a device ID / serial field)
// a set of tickets is about, by device type, against the size of the fleet. The
// fleet comes from crew numbers (devices per crew member, e.g. one vPOS and one
// card reader each). The Ryanair contract measures P1/P2 against the devices in
// use THAT DAY, so when a crew list has a typical share of crew flying per day
// (from a roster upload), the fleet is the crew flying that day and reports use
// each issue's worst single day. The share suggests a priority from admin
// thresholds; agents decide.

export const DEVICE_LIMITS = { types: 10, values: 20, p1: { min: 1, max: 100, default: 20 }, p2: { min: 1, max: 100, default: 5 } };
export const DEFAULT_DEVICE_TYPES = [
  { label: 'vPOS', perCrew: 1, values: ['vpos'] },
  { label: 'Card reader', perCrew: 1, values: ['bluepad', 'blue pad', 'pinpad', 'pin pad', 'card reader', 'card terminal'] },
];
export const DEFAULT_DEVICES = { idFieldId: '', typeFieldId: '', types: DEFAULT_DEVICE_TYPES, p1Percent: 20, p2Percent: 5 };

const clip = (value, length) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, length);
const whole = (value, { min, max, default: fallback }) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

/**
 * Validates device settings. The ID field may be any custom field with text
 * or choices (`idChoices`); the type field must be a selectable choice field.
 */
export function sanitizeDevices(input, { idChoices = [], selectable = [] } = {}) {
  const types = (Array.isArray(input?.types) ? input.types : DEFAULT_DEVICE_TYPES)
    .map((t) => ({
      label: clip(t?.label, 40),
      perCrew: Math.max(0, Math.min(20, Math.round(Number(t?.perCrew) * 10) / 10 || 0)),
      values: [...new Set((Array.isArray(t?.values) ? t.values : String(t?.values ?? '').split(','))
        .map((v) => clip(v, 60).toLowerCase()).filter(Boolean))].slice(0, DEVICE_LIMITS.values),
    }))
    .filter((t) => t.label && t.values.length)
    .slice(0, DEVICE_LIMITS.types);
  let p1 = whole(input?.p1Percent, DEVICE_LIMITS.p1);
  let p2 = whole(input?.p2Percent, DEVICE_LIMITS.p2);
  if (p2 > p1) [p1, p2] = [p2, p1];
  return {
    idFieldId: idChoices.some((f) => f.id === String(input?.idFieldId)) ? String(input.idFieldId) : '',
    typeFieldId: selectable.some((f) => f.id === String(input?.typeFieldId)) ? String(input.typeFieldId) : '',
    types,
    p1Percent: p1,
    p2Percent: p2,
  };
}

/** Custom fields that can hold a device ID: text fields and choice fields. */
export function deviceIdChoices(fields) {
  return (Array.isArray(fields) ? fields : [])
    .filter((f) => /^customfield_\d+$/.test(String(f?.id)) && ['string', 'option', 'array'].includes(f?.schema?.type) && (f.schema.type !== 'array' || ['string', 'option'].includes(f.schema.items)))
    .map((f) => ({ id: String(f.id), name: String(f.name).slice(0, 120) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

const text = (value) => {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap(text);
  if (typeof value === 'object') return text(value.value ?? value.name ?? value.displayName ?? '');
  return String(value).split(/[\n,;]+/).map((v) => v.trim()).filter(Boolean);
};

/**
 * The device a ticket is about: { ids: [normalised IDs], type: label | null }.
 * Tickets already reduced to `fields.__device` (full analysis) pass through.
 */
export function deviceOf(issue, config) {
  const f = issue?.fields || {};
  if (f.__device) return f.__device;
  if (!config?.idFieldId) return { ids: [], type: null };
  const ids = [...new Set(text(f[config.idFieldId]).map((v) => v.toUpperCase().replace(/\s+/g, '')).filter((v) => v.length >= 2 && v.length <= 80))];
  const typeText = text(config.typeFieldId ? f[config.typeFieldId] : null).join(' ').toLowerCase();
  const type = (config.types || []).find((t) => t.values.some((v) => typeText.includes(v)))?.label || null;
  return { ids, type };
}

/** Distinct devices among tickets, by type: { [label]: count }, plus `any` across all. */
export function devicesAffected(issues, config) {
  const byType = {};
  const all = new Set();
  const days = {}; // { date: { type: Set } } for the worst single day
  for (const issue of issues || []) {
    const { ids, type } = deviceOf(issue, config);
    const date = String(issue?.fields?.created || '').slice(0, 10);
    for (const id of ids) {
      all.add(id);
      const key = type || 'Other';
      (byType[key] = byType[key] || new Set()).add(id);
      if (date) ((days[date] ||= {})[key] ||= new Set()).add(id);
    }
  }
  // Per type, the most devices affected on any one day.
  const peak = {};
  for (const types of Object.values(days)) for (const [k, set] of Object.entries(types)) peak[k] = Math.max(peak[k] || 0, set.size);
  return { any: all.size, byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, v.size])), peak };
}

/** Adds device counts of merged groups (devices in two groups may be counted twice). */
export function addDevices(a, b) {
  if (!a) return b;
  if (!b) return a;
  const byType = { ...a.byType };
  for (const [k, v] of Object.entries(b.byType || {})) byType[k] = (byType[k] || 0) + v;
  // The worst day of either (the same day can't be told apart once merged).
  const peak = { ...(a.peak || {}) };
  for (const [k, v] of Object.entries(b.peak || {})) peak[k] = Math.max(peak[k] || 0, v);
  return { any: (a.any || 0) + (b.any || 0), byType, peak };
}

/** Fleet size per device type from crew numbers: { [label]: devices }. */
export function fleetFromCrew(crew, config) {
  if (!crew) return {};
  return Object.fromEntries((config?.types || []).map((t) => [t.label, Math.round(crew * t.perCrew)]).filter(([, n]) => n > 0));
}

/** Crew flying on a typical day for a crew list (its roster share), or null. */
export function crewFlyingPerDay(headcount) {
  const share = Number(headcount?.flying?.share);
  if (!headcount?.values?.length || !(share > 0)) return null;
  return Math.round(headcount.values.reduce((n, v) => n + v.count, 0) * (share / 100));
}

/**
 * The fleet to measure against: devices in use on a typical day when the crew
 * list has a share flying ({ daily: true }), else the whole fleet.
 */
export function fleetForHeadcount(headcount, config) {
  if (!headcount?.values?.length) return { fleet: {}, daily: false, crew: 0 };
  const flying = crewFlyingPerDay(headcount);
  const crew = flying ?? headcount.values.reduce((n, v) => n + v.count, 0);
  return { fleet: fleetFromCrew(crew, config), daily: flying !== null, crew };
}

/** Counts to judge against a daily fleet: each type's worst single day. */
export const worstDay = (counts) => (counts?.peak ? { any: Math.max(0, ...Object.values(counts.peak)), byType: counts.peak } : counts);

/** P1, P2 or null for a share of the fleet. */
export const suggestPriority = (share, config) => (share === null ? null : share >= config.p1Percent ? 'P1' : share >= config.p2Percent ? 'P2' : null);

/**
 * Device impact for a set of device counts against the fleet: per type with a
 * fleet size, the share affected and a suggested priority, worst first.
 */
export function deviceImpact(counts, fleet, config) {
  return Object.entries(counts?.byType || {})
    .map(([label, devices]) => {
      const size = fleet[label] || null;
      const share = size ? Math.round((devices / size) * 1000) / 10 : null;
      return { label, devices, fleet: size, share, suggested: suggestPriority(share, config) };
    })
    .sort((a, b) => (b.share ?? -1) - (a.share ?? -1) || b.devices - a.devices);
}

/** "312 of 16,266 vPOS (1.9%)" lines for alerts and ticket descriptions. */
export function impactText(impact) {
  return impact.map((i) => (i.fleet ? `${i.devices.toLocaleString('en-GB')} of ${i.fleet.toLocaleString('en-GB')} ${i.label} (${i.share}%)` : `${i.devices.toLocaleString('en-GB')} ${i.label}`)).join(', ');
}
