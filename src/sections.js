// Report sections an admin can hide (settings → Report sections), separately
// for customer and internal reports. A hidden section isn't shown on the agent
// page or in PDFs (downloaded or emailed), and its data isn't fetched. The
// headline numbers and the issue patterns are always shown.

export const REPORT_SECTIONS = [
  { key: 'ai', label: 'AI summary' },
  { key: 'activity', label: 'Ticket activity' },
  { key: 'standsOut', label: 'What stands out' },
  { key: 'health', label: 'Customer health', only: 'customers' },
  { key: 'flow', label: 'Flow and workload' },
  { key: 'team', label: 'Team performance', only: 'internal' },
  { key: 'escalation', label: 'Escalation levels', only: 'internal' },
  { key: 'dispatch', label: 'Hardware dispatch', only: 'internal' },
  { key: 'breakdowns', label: 'Breakdowns' },
  { key: 'crew', label: 'Tickets per 100 crew', only: 'customers' },
  { key: 'timeOfDay', label: 'When tickets arrive' },
  { key: 'dataQuality', label: 'Data quality' },
  { key: 'effort', label: 'Where the effort goes' },
  { key: 'devices', label: 'Devices affected' },
  { key: 'sla', label: 'SLAs' },
  { key: 'knowledge', label: 'Knowledge gaps' },
  { key: 'portal', label: 'Customer portal (publishing)', only: 'customers' },
];
export const SCOPES = ['customers', 'internal'];
export const DEFAULT_HIDDEN_SECTIONS = { customers: [], internal: [] };

/** Sections that apply to a scope ('customers' or 'internal'). */
export const sectionsFor = (scope) => REPORT_SECTIONS.filter((s) => !s.only || s.only === scope);

/** { customers: [keys], internal: [keys] } with known keys only. */
export function sanitizeHiddenSections(input) {
  const out = {};
  for (const scope of SCOPES) {
    const known = new Set(sectionsFor(scope).map((s) => s.key));
    const list = Array.isArray(input?.[scope]) ? input[scope] : [];
    out[scope] = [...new Set(list.map(String))].filter((k) => known.has(k));
  }
  return out;
}

/** The hidden section keys for an analysis payload (internal or customer). */
export const hiddenFor = (hiddenSections, payload) => (hiddenSections?.[payload?.scope === 'internal' ? 'internal' : 'customers'] || []);
