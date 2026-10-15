// Email reports: schedules that send the report PDF to internal staff and
// customer contacts through Microsoft 365 (Graph sendMail). This file holds the
// rules (validation, when a schedule is due, the period it covers, the message);
// the Microsoft calls are in graph.js and the job in emailJobs.js.
import { presetRange, PRESETS } from './dates.js';
import { validTimeZone } from './timeOfDay.js';

export const MAX_SCHEDULES = 30;
export const MAX_RECIPIENTS = 25;
export const EMAIL_PERIODS = ['last-week', 'last-month', 'last-30', 'last-90', 'last-quarter'];
const EMAIL = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clip = (value, length) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, length);
const whole = (value, min, max, fallback) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
};

/** Email addresses from a list or comma / new-line text: valid, unique, bounded. */
export function emailList(input) {
  const items = Array.isArray(input) ? input : String(input ?? '').split(/[\s,;]+/);
  const seen = new Set();
  return items.map((e) => clip(e, 254).toLowerCase()).filter((e) => EMAIL.test(e) && !seen.has(e) && seen.add(e)).slice(0, MAX_RECIPIENTS);
}

/** The Microsoft 365 connection (the client secret is kept separately as a Forge secret). */
export function sanitizeEmailConfig(input) {
  const tenantId = clip(input?.tenantId, 64);
  const clientId = clip(input?.clientId, 64);
  const sender = clip(input?.sender, 254).toLowerCase();
  return {
    tenantId: GUID.test(tenantId) || /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(tenantId) ? tenantId : '',
    clientId: GUID.test(clientId) ? clientId : '',
    sender: EMAIL.test(sender) ? sender : '',
  };
}

/** A schedule as stored, or throws with a message for the settings page. */
export function sanitizeSchedule(input, organizations = [], { now = new Date() } = {}) {
  const name = clip(input?.name, 80);
  if (!name) throw new Error('Give the schedule a name.');
  const known = new Map(organizations.map((o) => [String(o.id), o]));
  const seen = new Set();
  const orgs = (Array.isArray(input?.organizations) ? input.organizations : [])
    .map((o) => known.get(String(o?.id ?? o)))
    .filter((o) => o && !seen.has(o.id) && seen.add(o.id))
    .slice(0, 10)
    .map((o) => ({ id: String(o.id), name: String(o.name) }));
  if (!orgs.length) throw new Error('Choose at least one organisation.');
  const internal = emailList(input?.internal);
  const customers = emailList(input?.customers);
  if (!internal.length && !customers.length) throw new Error('Add at least one recipient.');
  const frequency = ['weekly', 'monthly', 'manual'].includes(input?.frequency) ? input.frequency : 'weekly';
  return {
    id: /^s-[a-z0-9-]{4,40}$/.test(String(input?.id)) ? String(input.id) : `s-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    enabled: input?.enabled !== false,
    organizations: orgs,
    period: EMAIL_PERIODS.includes(input?.period) ? input.period : (frequency === 'monthly' ? 'last-month' : 'last-week'),
    frequency,
    weekday: whole(input?.weekday, 1, 7, 1), // 1 = Monday
    dayOfMonth: whole(input?.dayOfMonth, 1, 28, 1),
    hour: whole(input?.hour, 0, 23, 8),
    timeZone: validTimeZone(input?.timeZone),
    internal,
    customers,
    ai: input?.ai === true,
    subject: clip(input?.subject, 150),
    message: String(input?.message ?? '').replace(/\r\n/g, '\n').trim().slice(0, 2000),
  };
}

/** Wall-clock parts of `now` in a time zone. */
function zoned(now, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short', hourCycle: 'h23' })
    .formatToParts(now).map((p) => [p.type, p.value]));
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday) + 1;
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour), weekday };
}

/** The latest time this schedule should have sent at, as a local "YYYY-MM-DD HH" key, or null. */
export function lastSlot(schedule, now = new Date()) {
  if (schedule.frequency === 'manual') return null;
  const z = zoned(now, schedule.timeZone);
  const local = new Date(Date.UTC(z.year, z.month - 1, z.day));
  const key = (d) => `${d.toISOString().slice(0, 10)} ${String(schedule.hour).padStart(2, '0')}`;
  if (schedule.frequency === 'weekly') {
    let back = (z.weekday - schedule.weekday + 7) % 7;
    if (back === 0 && z.hour < schedule.hour) back = 7;
    return key(new Date(local.getTime() - back * 86400000));
  }
  // Monthly: this month's day, or last month's if it hasn't come yet.
  let year = z.year;
  let month = z.month - 1;
  if (z.day < schedule.dayOfMonth || (z.day === schedule.dayOfMonth && z.hour < schedule.hour)) month -= 1;
  if (month < 0) { month = 11; year -= 1; }
  return key(new Date(Date.UTC(year, month, schedule.dayOfMonth)));
}

/** Due when switched on and the latest slot hasn't been sent (state.lastSlot). */
export function isEmailDue(schedule, state = {}, now = new Date()) {
  if (!schedule.enabled) return false;
  const slot = lastSlot(schedule, now);
  return Boolean(slot) && state.lastSlot !== slot && !(state.queuedSlot === slot && now - Date.parse(state.queuedAt || 0) < 3600000);
}

/** The period a schedule reports on, in its time zone: { from, to }. */
export function periodFor(schedule, now = new Date()) {
  const z = zoned(now, schedule.timeZone);
  return presetRange(schedule.period, new Date(z.year, z.month - 1, z.day, z.hour));
}

const escape = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const periodLabel = (key) => PRESETS.find((p) => p.key === key)?.label || key;

/** The Graph sendMail message: customers in To (internal staff in Cc), or internal staff in To. */
export function emailMessage(schedule, { from, to, title, fileName, pdfBase64 }) {
  const address = (a) => ({ emailAddress: { address: a } });
  const toList = schedule.customers.length ? schedule.customers : schedule.internal;
  const ccList = schedule.customers.length ? schedule.internal : [];
  const subject = (schedule.subject || `{organisation} service report: {period}`)
    .replace(/\{organisation\}/g, title).replace(/\{period\}/g, `${from} to ${to}`).slice(0, 200);
  const intro = schedule.message || `Please find attached the service report for ${title}, covering ${from} to ${to} (${periodLabel(schedule.period).toLowerCase()}).`;
  return {
    message: {
      subject,
      body: { contentType: 'HTML', content: `<p>${escape(intro).replace(/\n/g, '<br>')}</p><p style="color:#626f86;font-size:12px">Sent by Customer Insights for Jira Service Management.</p>` },
      toRecipients: toList.map(address),
      ccRecipients: ccList.map(address),
      attachments: [{ '@odata.type': '#microsoft.graph.fileAttachment', name: fileName, contentType: 'application/pdf', contentBytes: pdfBase64 }],
    },
    saveToSentItems: true,
  };
}
