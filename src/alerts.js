// Spike alerts: once a day per watched organisation, the last 7 days are
// compared with the 7 before. A pattern that jumps by the admin's threshold
// becomes an alert agents see in the app and, if switched on, a Jira ticket.
// Background jobs read Jira as the app; agents only see alerts for
// organisations their own Jira access shows them (see index.js getAlerts).
import { asApp, route } from '@forge/api';
import { changeText } from './alertText.js';
import { parseQuery, readJson, requestWithRetry, runAnalysis } from './engine.js';

export { changeText };

export const DAY = 86400000;
const CHECK_EVERY_MS = 20 * 3600000; // about daily; the scheduler runs hourly
const QUIET_DAYS = 7; // the same pattern isn't alerted again within this
const MAX_KEYS = 100;
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const clip = (value, length) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, length);
const themeKey = (theme) => clip(theme, 120).toLowerCase();

/** The last 7 whole days (UTC), ending yesterday. */
export function alertWindow(now = Date.now()) {
  const today = Date.parse(`${iso(now)}T00:00:00Z`);
  return { from: iso(today - 7 * DAY), to: iso(today - DAY) };
}

export function isCheckDue(state, now = Date.now()) {
  return !state?.checkedAt || now - Date.parse(state.checkedAt) >= CHECK_EVERY_MS;
}

/**
 * Patterns that jumped: at least `minTickets` this week and up by at least
 * `thresholdPercent` on the week before (or new with `minTickets`). Patterns
 * alerted in the last QUIET_DAYS (`seen`: { themeKey: ISO time }) are skipped.
 */
export function findSpikes(report, { thresholdPercent, minTickets }, seen = {}, now = Date.now()) {
  return (report?.groups || [])
    .filter((g) => g.count >= minTickets)
    .filter((g) => (g.previousCount ? ((g.count - g.previousCount) / g.previousCount) * 100 >= thresholdPercent : true))
    .filter((g) => {
      const last = Date.parse(seen[themeKey(g.theme)] || '');
      return !Number.isFinite(last) || now - last >= QUIET_DAYS * DAY;
    })
    .map((g) => ({
      theme: clip(g.theme, 120),
      count: g.count,
      previousCount: g.previousCount,
      changePercent: g.previousCount ? Math.round(((g.count - g.previousCount) / g.previousCount) * 100) : null,
      estimated: Boolean(g.estimated),
      keys: (g.keys || g.tickets?.map((t) => t.key) || []).slice(0, MAX_KEYS),
      examples: (g.tickets || []).slice(0, 3).map((t) => ({ key: t.key, summary: clip(t.summary, 200) })),
    }));
}

// ---- Jira ticket per alert (optional) ------------------------------------------

const text = (value) => ({ type: 'text', text: value });
const link = (value, href) => ({ type: 'text', text: value, marks: [{ type: 'link', attrs: { href } }] });
const paragraph = (...content) => ({ type: 'paragraph', content });

/** Fields for POST /rest/api/3/issue. `siteUrl` makes the ticket keys links. */
export function issueFields(alert, { projectKey, issueTypeId }, siteUrl = '') {
  const keyNode = (key) => (siteUrl ? link(key, `${siteUrl}/browse/${key}`) : text(key));
  const keys = alert.keys.slice(0, 50);
  const search = siteUrl && keys.length ? `${siteUrl}/issues/?jql=${encodeURIComponent(`key in (${keys.join(', ')}) ORDER BY created DESC`)}` : '';
  const content = [
    paragraph(text(`Customer Insights found a spike for ${alert.organization.name} between ${alert.window.from} and ${alert.window.to}: "${alert.theme}", ${changeText(alert)}.`)),
  ];
  if (alert.examples.length) {
    content.push(paragraph(text('Examples: ')));
    content.push({
      type: 'bulletList',
      content: alert.examples.map((e) => ({ type: 'listItem', content: [paragraph(keyNode(e.key), text(` ${e.summary}`))] })),
    });
  }
  if (search) content.push(paragraph(link(`Open the ${keys.length} tickets in Jira`, search)));
  content.push(paragraph(text('Patterns come from matching ticket text and are clues for review, not confirmed root causes.')));
  return {
    project: { key: projectKey },
    issuetype: { id: issueTypeId },
    summary: clip(`Spike: ${alert.theme} for ${alert.organization.name} (${changeText(alert)})`, 250),
    labels: ['customer-insights-spike'],
    description: { type: 'doc', version: 1, content },
  };
}

async function siteUrlOf() {
  try {
    const response = await asApp().requestJira(route`/rest/api/3/serverInfo`, { headers: { Accept: 'application/json' } });
    return String((await readJson(response, 'Server info')).baseUrl || '').replace(/\/$/, '');
  } catch { return ''; }
}

async function createIssue(alert, config, siteUrl) {
  const response = await requestWithRetry(() => asApp().requestJira(route`/rest/api/3/issue`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: issueFields(alert, config, siteUrl) }),
  }));
  return (await readJson(response, 'Create ticket')).key;
}

// ---- The daily check -----------------------------------------------------------

/**
 * Testing only: `forge variables set ALERTS_AS_OF 2026-09-10` checks the week
 * before that date instead of the last week (sites with old test data).
 */
export function asOf(now, value = process.env.ALERTS_AS_OF) {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? '').trim()) ? Date.parse(`${String(value).trim()}T12:00:00Z`) : NaN;
  return Number.isFinite(date) ? date : now;
}

/**
 * Checks one watched organisation and stores any alerts. `store` is
 * src/storage.js (passed in so tests can fake it).
 */
export async function checkOrganisation(orgId, store, now = Date.now()) {
  const settings = await store.loadSettings();
  const config = settings.alerts;
  const organization = config?.enabled && config.organizations.find((o) => o.id === String(orgId));
  if (!organization) return { skipped: 'not watched' };
  const state = await store.loadAlertState(orgId);
  try {
    const window = alertWindow(asOf(now));
    const query = parseQuery({ organization, startDate: window.from, endDate: window.to });
    const report = await runAnalysis(query, { breakdowns: settings.breakdowns, minPatternSize: settings.minPatternSize, placeholders: settings.placeholders, mode: 'app', budgetMs: 240000 });
    const spikes = findSpikes(report, config, state.seen, now);
    const siteUrl = spikes.length && config.createIssue ? await siteUrlOf() : '';
    const seen = Object.fromEntries(Object.entries(state.seen || {}).filter(([, at]) => now - Date.parse(at) < QUIET_DAYS * DAY));
    for (const [n, spike] of spikes.entries()) {
      const alert = { ...spike, id: `${now}-${organization.id}-${n}`, organization, window, createdAt: new Date(now).toISOString(), baseJql: report.baseJql };
      if (config.createIssue && config.projectKey && config.issueTypeId) {
        try { alert.issueKey = await createIssue(alert, config, siteUrl); } catch (error) { alert.issueError = clip(error.message, 300); }
      }
      await store.saveAlert(alert);
      seen[themeKey(spike.theme)] = alert.createdAt;
    }
    await store.saveAlertState(orgId, { checkedAt: new Date(now).toISOString(), seen, lastError: null, queuedAt: null });
    console.log(`alerts: ${organization.id} checked, ${spikes.length} spikes`);
    return { spikes: spikes.length };
  } catch (error) {
    await store.saveAlertState(orgId, { ...state, checkedAt: new Date(now).toISOString(), lastError: clip(error.message, 300), queuedAt: null });
    console.error(`alerts: check failed for ${orgId}: ${error.message}`);
    return { failed: true };
  }
}
