// Email report jobs (queued by the hourly scheduler or "Send now"): run the
// analysis as the app, build the same PDF agents download, and send it through
// Microsoft 365. Settings and schedules are admin-only (index.js).
import { jsPDF } from 'jspdf';
import { backlogFor, parseQuery, runAnalysis, satisfactionField } from './engine.js';
import { analysisConfig } from './settings.js';
import { applyMerges, categoriesOf } from './analysis.js';
import { suggestCategories, suggestMerges, summarise } from './ai.js';
import { crewRates, headcountFor } from './headcount.js';
import { healthOf } from './health.js';
import { hiddenFor } from './sections.js';
import { pdfContent, pdfFileName } from './pdfReport.js';
import { buildPdf } from '../static/app/src/exportPdf.js';
import { emailMessage, periodFor } from './email.js';
import { graphToken, sendMail } from './graph.js';
import * as storage from './storage.js';

/** The report, AI summary (optional) and PDF for a schedule, as the app. */
export async function schedulePdf(schedule, settings, now = new Date(), { internal = false } = {}) {
  const { from, to } = periodFor(schedule, now);
  const payload = { organization: schedule.organizations[0], organizations: schedule.organizations, startDate: from, endDate: to, timeZone: schedule.timeZone };
  const config = analysisConfig(settings, payload);
  const query = parseQuery(payload);
  const report = await runAnalysis(query, {
    breakdowns: settings.breakdowns || [], ...config.patterns, slaFields: config.slaFields, devices: settings.devices, channelField: settings.channelField || null,
    satisfactionId: await satisfactionField('app'), mode: 'app', budgetMs: 240000,
  });
  // Emailed reports leave out the sections hidden for customer reports.
  const hidden = hiddenFor(settings.hiddenSections, payload);
  let ai = null;
  if (schedule.ai && !hidden.includes('ai') && report.groups.length) {
    let groups = report.groups;
    try { groups = applyMerges(report.groups, (await suggestMerges(report)).merges); } catch (error) { console.log(`email: AI merge skipped: ${error.message}`); }
    let categories = [];
    try { const r = await suggestCategories({ ...report, groups }); categories = r.categories.length > 1 ? categoriesOf(groups, r.categories) : []; } catch (error) { console.log(`email: AI categories skipped: ${error.message}`); }
    try { ai = { ...(await summarise({ ...report, groups, categories })), groups, categories }; } catch (error) { console.log(`email: AI summary skipped: ${error.message}`); }
  }
  const headcount = headcountFor(settings.headcounts, schedule.organizations.map((o) => o.id));
  const crew = headcount ? crewRates(report, headcount) : null;
  const [company, customer] = await Promise.all([storage.loadLogo('company'), schedule.organizations.length === 1 ? storage.loadLogo(schedule.organizations[0].id) : null]);
  // The health score only goes to internal staff (a schedule with no customer recipients).
  const health = internal && !hidden.includes('health') ? healthOf(report, await backlogFor(query, 'app')) : null;
  const content = pdfContent({ report, groups: ai?.groups || report.groups, ai, crew, health, hidden, generatedAt: now });
  const doc = buildPdf(jsPDF, content, { product: 'Customer Insights', logos: { company, customer } });
  return {
    from, to,
    title: report.organization,
    fileName: pdfFileName(report),
    pdfBase64: Buffer.from(doc.output('arraybuffer')).toString('base64'),
    tickets: report.currentCount,
  };
}

/** Builds and sends one schedule; records the outcome in its state and the send log. */
export async function sendSchedule(scheduleId, { reason = 'schedule', slot = null, now = new Date(), overrideTo = null } = {}) {
  const [settings, schedules, emailConfig, secret] = await Promise.all([storage.loadSettings(), storage.loadSchedules(), storage.loadEmailConfig(), storage.loadEmailSecret()]);
  const schedule = schedules.find((s) => s.id === scheduleId);
  if (!schedule) return { skipped: 'no schedule' };
  const startedAt = Date.now();
  // A test goes only to the admin's address.
  const target = overrideTo ? { ...schedule, internal: [overrideTo], customers: [] } : schedule;
  try {
    const pdf = await schedulePdf(schedule, settings, now, { internal: target.customers.length === 0 });
    const token = await graphToken(emailConfig, secret);
    await sendMail(token, emailConfig.sender, emailMessage(target, pdf));
    const recipients = target.internal.length + target.customers.length;
    await storage.updateScheduleState(scheduleId, { lastSentAt: now.toISOString(), lastError: null, queuedAt: null, ...(slot ? { lastSlot: slot } : {}) });
    await storage.logEmail({ at: now.toISOString(), scheduleId, name: schedule.name, reason, recipients, period: `${pdf.from} to ${pdf.to}`, ok: true });
    console.log(`email: sent ${scheduleId} (${reason}) to ${recipients} recipients, ${pdf.tickets} tickets, ${Math.round(pdf.pdfBase64.length / 1365)} KB, ${Date.now() - startedAt}ms`);
    return { sent: true };
  } catch (error) {
    const message = String(error.message || error).slice(0, 300);
    await storage.updateScheduleState(scheduleId, { lastError: message, lastErrorAt: now.toISOString(), queuedAt: null, ...(slot ? { lastSlot: slot } : {}) });
    await storage.logEmail({ at: now.toISOString(), scheduleId, name: schedule.name, reason, ok: false, error: message });
    console.error(`email: ${scheduleId} failed: ${message}`);
    return { failed: true };
  }
}
