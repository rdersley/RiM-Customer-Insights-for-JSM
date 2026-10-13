// Devices affected: how many distinct devices (by a device ID / serial field)
// a set of tickets is about, by device type, against the size of the fleet. The
// fleet comes from crew numbers for now (devices per crew member, e.g. one vPOS
// and one card reader each). The share of the fleet affected suggests a priority
// (P1/P2) from admin thresholds; agents decide.

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
  for (const issue of issues || []) {
    const { ids, type } = deviceOf(issue, config);
    for (const id of ids) {
      all.add(id);
      const key = type || 'Other';
      (byType[key] = byType[key] || new Set()).add(id);
    }
  }
  return { any: all.size, byType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, v.size])) };
}

/** Adds device counts of merged groups (devices in two groups may be counted twice). */
export function addDevices(a, b) {
  if (!a) return b;
  if (!b) return a;
  const byType = { ...a.byType };
  for (const [k, v] of Object.entries(b.byType || {})) byType[k] = (byType[k] || 0) + v;
  return { any: (a.any || 0) + (b.any || 0), byType };
}

/** Fleet size per device type from crew numbers: { [label]: devices }. */
export function fleetFromCrew(crew, config) {
  if (!crew) return {};
  return Object.fromEntries((config?.types || []).map((t) => [t.label, Math.round(crew * t.perCrew)]).filter(([, n]) => n > 0));
}

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
