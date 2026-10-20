// Hardware dispatch (internal reports, per project settings, e.g. HW): how long
// devices take to go out against a target (48 hours by default), the queue still
// waiting and how old it is, devices sent but not yet returned, and whether the
// queue is growing, overall and by device type. Times are calendar hours from
// the ticket being created to its first move to a "sent" status.

export const DEFAULT_DISPATCH = {
  enabled: false,
  deviceFieldId: '',
  queueStatuses: ['Open'],
  sentStatuses: ['Dispatched to Customer', 'Waiting Device Return'],
  returnStatuses: ['Waiting Device Return'],
  targetHours: 48,
};
export const DISPATCH_WEEKS = 12;
export const QUEUE_BANDS = [{ label: 'Within target', maxHours: null }, { label: 'Up to 7 days', maxHours: 168 }, { label: '7–30 days', maxHours: 720 }, { label: '30–90 days', maxHours: 2160 }, { label: 'Over 90 days', maxHours: Infinity }];
const NOT_SET = '(not set)';
const HOUR = 3600000;

const clip = (value, length) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, length);
const statusList = (input, fallback) => {
  const list = [...new Set((Array.isArray(input) ? input : String(input ?? '').split(/[\n,]/)).map((n) => clip(n, 60)).filter(Boolean))].slice(0, 20);
  return list.length ? list : fallback;
};

/** Dispatch settings for a project; the device field must be one an admin can pick. */
export function sanitizeDispatch(input, selectable = []) {
  const target = Number(input?.targetHours);
  return {
    enabled: input?.enabled === true,
    deviceFieldId: selectable.some((f) => f.id === String(input?.deviceFieldId)) ? String(input.deviceFieldId) : '',
    queueStatuses: statusList(input?.queueStatuses, DEFAULT_DISPATCH.queueStatuses),
    sentStatuses: statusList(input?.sentStatuses, DEFAULT_DISPATCH.sentStatuses),
    returnStatuses: statusList(input?.returnStatuses, []),
    targetHours: Number.isInteger(target) && target >= 1 && target <= 2000 ? target : DEFAULT_DISPATCH.targetHours,
  };
}

/** A ticket's device type (first value of the device field), or "(not set)". */
export function deviceOf(issue, fieldId) {
  const v = fieldId ? issue?.fields?.[fieldId] : null;
  const first = Array.isArray(v) ? v[0] : v;
  return clip(first?.value ?? first?.name ?? first, 80) || NOT_SET;
}

const changeTime = (value) => (typeof value === 'number' ? value : /^\d+$/.test(String(value)) ? Number(value) : Date.parse(value));

/**
 * Hours from creation to the first move into a sent status at or after `from`
 * (ms), from the ticket's status history, or null if it hasn't moved there.
 */
export function hoursToSent(issue, histories, sentStatuses, from = 0) {
  const sent = new Set(sentStatuses.map((s) => s.toLowerCase()));
  const created = Date.parse(issue?.fields?.created);
  const times = (histories || [])
    .flatMap((h) => (h.items || []).filter((i) => (i.fieldId || i.field) === 'status' && sent.has(String(i.toString || '').toLowerCase())).map(() => changeTime(h.created)))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  const first = times.find((t) => t >= from) ?? null;
  return first === null || !Number.isFinite(created) ? null : Math.max(0, (first - created) / HOUR);
}

const quantile = (sorted, p) => (sorted.length ? Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] * 10) / 10 : null);

/**
 * The card's figures. `queue`: tickets waiting (with created and device field);
 * `sent`: [{ device, hours }] sent in the period; `returns`: tickets waiting for
 * the old device back; `weekly`: [{ from, created, sent }] oldest first.
 */
export function dispatchSummary({ queue = [], sent = [], returns = [], weekly = [], config, now = Date.now() }) {
  const target = config.targetHours;
  const devices = new Map();
  const row = (name) => {
    if (!devices.has(name)) devices.set(name, { device: name, queue: 0, overTarget: 0, oldestDays: 0, sentHours: [], returns: 0 });
    return devices.get(name);
  };
  const bands = QUEUE_BANDS.map((b) => ({ label: b.label === 'Within target' ? `Within ${target} h` : b.label, count: 0 }));
  let overTarget = 0;
  for (const issue of queue) {
    const ageHours = (now - Date.parse(issue.fields.created)) / HOUR;
    const r = row(deviceOf(issue, config.deviceFieldId));
    r.queue += 1;
    r.oldestDays = Math.max(r.oldestDays, Math.floor(ageHours / 24));
    if (ageHours > target) { r.overTarget += 1; overTarget += 1; }
    const band = ageHours <= target ? 0 : QUEUE_BANDS.findIndex((b, i) => i > 0 && ageHours <= b.maxHours);
    bands[band].count += 1;
  }
  for (const s of sent) row(s.device).sentHours.push(s.hours);
  for (const issue of returns) row(deviceOf(issue, config.deviceFieldId)).returns += 1;
  const stats = (hours) => {
    const sorted = [...hours].sort((a, b) => a - b);
    const within = sorted.filter((h) => h <= target).length;
    return { sent: sorted.length, medianHours: quantile(sorted, 0.5), p90Hours: quantile(sorted, 0.9), withinTarget: within, withinShare: sorted.length ? Math.round((within / sorted.length) * 100) : null };
  };
  const byDevice = [...devices.values()]
    .map(({ sentHours, ...r }) => ({ ...r, ...stats(sentHours) }))
    .sort((a, b) => b.overTarget - a.overTarget || b.queue - a.queue || b.sent - a.sent);
  // Recent weeks (the last full 4, or fewer) for the trend and when the queue would clear.
  const recent = weekly.slice(-4); // the last 4 full weeks
  const avg = (key) => (recent.length ? Math.round((recent.reduce((n, w) => n + (w[key] || 0), 0) / recent.length) * 10) / 10 : null);
  const createdPerWeek = avg('created');
  const sentPerWeek = avg('sent');
  const net = createdPerWeek === null || sentPerWeek === null ? null : Math.round((createdPerWeek - sentPerWeek) * 10) / 10;
  return {
    targetHours: target,
    queue: { total: queue.length, overTarget, oldestDays: Math.max(0, ...byDevice.map((d) => d.oldestDays)), bands },
    sent: stats(sent.map((s) => s.hours)),
    returns: returns.length,
    byDevice,
    weekly,
    trend: { createdPerWeek, sentPerWeek, net, clearWeeks: net !== null && net < 0 && queue.length ? Math.ceil(queue.length / -net) : null },
  };
}

/** "26.3 days" / "31 h" for dispatch times. */
export function hoursText(hours) {
  if (hours === null || hours === undefined) return '–';
  return hours < 48 ? `${Math.round(hours)} h` : `${Math.round((hours / 24) * 10) / 10} days`;
}

/** The PDF section (pdfReport.js) for dispatch figures, or null. */
export function dispatchSection(d) {
  if (!d || (!d.queue.total && !d.sent.sent)) return null;
  const t = d.trend;
  const lines = [
    `${d.sent.sent.toLocaleString('en-GB')} sent in the period: median ${hoursText(d.sent.medianHours)}, 90% within ${hoursText(d.sent.p90Hours)}; ${d.sent.withinShare ?? 0}% within the ${d.targetHours}-hour target.`,
    `${d.queue.total.toLocaleString('en-GB')} waiting to be sent, ${d.queue.overTarget.toLocaleString('en-GB')} over ${d.targetHours} hours (oldest ${d.queue.oldestDays} days).${d.returns ? ` ${d.returns.toLocaleString('en-GB')} sent devices not yet returned.` : ''}`,
  ];
  if (t.net !== null) lines.push(t.net > 0 ? `The queue is growing by about ${t.net} a week (${t.createdPerWeek} requests vs ${t.sentPerWeek} sent a week).` : t.clearWeeks ? `At the current rate (${t.sentPerWeek} sent vs ${t.createdPerWeek} requests a week) the queue clears in about ${t.clearWeeks} weeks.` : 'Requests and dispatches are level.');
  return {
    lines,
    devices: d.byDevice.slice(0, 15).map((r) => ({ device: r.device, queue: String(r.queue), overTarget: String(r.overTarget), sent: String(r.sent), median: hoursText(r.medianHours), within: r.withinShare === null ? '–' : `${r.withinShare}%`, returns: String(r.returns) })),
  };
}
