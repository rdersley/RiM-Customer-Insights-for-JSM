import ResolverModule from '@forge/resolver';
import { asUser, route } from '@forge/api';
import { textOf } from './analysis.js';
import { filterFor, organisationsOf, parseQuery, pool, readJson, runAnalysis, searchPage } from './engine.js';
import { licenseAllows, UNLICENSED_MESSAGE } from './license.js';
import { exportBackupPage, importBackupBatch } from './backup.js';
import { suggestCategories, suggestMerges, summarise } from './ai.js';
import { snapshotFrom } from './publish.js';
import { deleteLive, deleteReport, listAlerts, listOrgLogos, loadAlert, loadLiveConfig, loadLiveState, loadLogo, loadReport, loadSettings, saveAlert, saveLiveConfig, saveLogo, saveReport, saveSettings } from './storage.js';
import { MAX_ORG_LOGOS, sanitizeLogo } from './logos.js';
import { headcountFor, orgsOf } from './headcount.js';
import { isLive, liveConfigFrom } from './live.js';
import { queueAlertCheck, queueRefresh } from './liveJobs.js';
import { organisationBreakdown, sanitizeSettings, selectableFields } from './settings.js';
import { problemFields, problemRequest, relatesLinkType } from './problem.js';

// This package is "type": "module"; Forge's bundler then hands CommonJS packages
// over as their exports object, so the class sits on `.default`.
const Resolver = ResolverModule.default ?? ResolverModule;
const resolver = new Resolver();

// Agent-only. Portal customers use src/portal.js; this also refuses them here
// in case a module is ever pointed at the wrong function.
function define(name, fn) {
  resolver.define(name, (request) => {
    const type = request?.context?.accountType;
    if (type && type !== 'licensed') throw new Error('Customer Insights is only available to agents.');
    return fn(request);
  });
}
const FETCH_BUDGET_MS = 15000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Organisations the signed-in user can see (up to 500). */
async function listOrganizations() {
  const organizations = [];
  let start = 0;
  for (let page = 0; page < 10; page += 1) {
    const response = await asUser().requestJira(route`/rest/servicedeskapi/organization?start=${start}&limit=50`, { headers: { Accept: 'application/json' } });
    const data = await readJson(response, 'Organization lookup');
    organizations.push(...(data.values || []).map(({ id, name }) => ({ id: String(id), name })));
    if (!data.isLastPage && data.values?.length) start += data.values.length;
    else break;
  }
  return organizations;
}

// Unlicensed installs get the flag and nothing else, so the page can explain why.
define('getOrganizations', async ({ context }) => {
  if (!licenseAllows(context)) return { licensed: false, organizations: [] };
  return { licensed: true, organizations: await listOrganizations() };
});

// ---- Spike alerts (src/alerts.js) --------------------------------------------
// Alerts are found by a background job reading as the app, so each agent only
// gets alerts for organisations their own Jira access shows them.

const ALERTS_SHOWN = 20;

define('getAlerts', async ({ context }) => {
  if (!licenseAllows(context)) throw new Error(UNLICENSED_MESSAGE);
  const { alerts: config, surge } = await loadSettings();
  if (!config?.enabled && !surge?.enabled) return { enabled: false, alerts: [] };
  const [visible, alerts] = await Promise.all([listOrganizations(), listAlerts()]);
  const ids = new Set(visible.map((o) => o.id));
  return { enabled: true, alerts: alerts.filter((a) => !a.dismissedAt && ids.has(a.organization.id)).slice(0, ALERTS_SHOWN) };
});

// Settings page: run the check for every watched organisation now. Jira admins only.
define('checkAlertsNow', async ({ context }) => {
  if (!licenseAllows(context)) throw new Error(UNLICENSED_MESSAGE);
  if (!(await isJiraAdmin())) throw new Error('Only Jira admins can run the spike check.');
  const { alerts: config } = await loadSettings();
  if (!config?.enabled || !config.organizations.length) throw new Error('Turn on spike alerts and save at least one organisation first.');
  for (const organization of config.organizations) await queueAlertCheck(organization.id);
  console.log(`checkAlertsNow: queued ${config.organizations.length}`);
  return { queued: config.organizations.length };
});

define('dismissAlert', async ({ payload, context }) => {
  if (!licenseAllows(context)) throw new Error(UNLICENSED_MESSAGE);
  const alert = await loadAlert(payload?.id);
  if (!alert) return { dismissed: true };
  const visible = await listOrganizations();
  if (!visible.some((o) => o.id === alert.organization.id)) throw new Error('You can’t change alerts for that organisation.');
  // Who dismissed it isn't kept: the app stores no account ids.
  await saveAlert({ ...alert, dismissedAt: new Date().toISOString() });
  return { dismissed: true };
});

// Full analysis: the page pages through every ticket in date slices and groups
// them itself (see static/app/src/fullAnalysis.js). Each call reads Jira as the
// user, stays well inside the 25s limit, and returns only what grouping needs.
const FULL_PAGES_PER_CALL = 5;
const FULL_CALL_BUDGET_MS = 12000;
const DESCRIPTION_CHARS = 600;

/**
 * The admin's breakdown fields, plus "Organisation" when an analysis covers
 * several organisations (limited to those selected).
 */
async function breakdownsFor(payload) {
  const { breakdowns } = await loadSettings();
  const organisations = organisationsOf(payload);
  if (organisations.length < 2) return breakdowns;
  const response = await asUser().requestJira(route`/rest/api/3/field`, { headers: { Accept: 'application/json' } });
  const byOrganisation = organisationBreakdown(await readJson(response, 'Field list'), organisations.map((o) => o.name));
  return byOrganisation ? [byOrganisation, ...breakdowns] : breakdowns;
}

define('fetchTickets', async ({ payload, context }) => {
  if (!licenseAllows(context)) throw new Error(UNLICENSED_MESSAGE);
  const breakdowns = await breakdownsFor(payload);
  const query = parseQuery(payload, filterFor(payload?.filter, breakdowns));
  const { from, toExclusive } = payload;
  if (!ISO_DATE.test(from || '') || !ISO_DATE.test(toExclusive || '') || from < query.previousStart || toExclusive > query.endExclusive || from >= toExclusive) {
    throw new Error('Invalid ticket range.');
  }
  const deadline = Date.now() + FULL_CALL_BUDGET_MS;
  const tickets = [];
  let token = typeof payload.nextPageToken === 'string' ? payload.nextPageToken : undefined;
  for (let page = 0; page < FULL_PAGES_PER_CALL; page += 1) {
    const result = await searchPage(query.between(from, toExclusive), 100, token, breakdowns);
    for (const issue of result.issues) {
      tickets.push({
        key: issue.key,
        self: issue.self,
        dims: issue.dims,
        fields: {
          summary: issue.fields?.summary || '',
          description: textOf(issue.fields?.description).join(' ').slice(0, DESCRIPTION_CHARS),
          created: issue.fields?.created,
          resolutiondate: issue.fields?.resolutiondate || null,
          status: { name: issue.fields?.status?.name || 'Unknown' },
        },
      });
    }
    token = result.nextPageToken;
    if (!token || Date.now() > deadline) break;
  }
  return { tickets, nextPageToken: token || null };
});

define('analyze', async ({ payload, context }) => {
  if (!licenseAllows(context)) throw new Error(UNLICENSED_MESSAGE);
  const { minPatternSize, placeholders, synonyms } = await loadSettings();
  const breakdowns = await breakdownsFor(payload);
  const query = parseQuery(payload, filterFor(payload?.filter, breakdowns));
  // Resolvers are killed at 25s; runAnalysis stops starting new fetches after the budget.
  return runAnalysis(query, { breakdowns, minPatternSize, placeholders, synonyms, mode: 'user', budgetMs: FETCH_BUDGET_MS });
});

// Opt-in, separate from analyze so it gets its own time limit. The report comes
// from this user's own analysis in the page; aiInput() bounds what is sent.
// Step 1 of the AI summary: which rule-based groups are the same issue. Only
// indexes and titles come back; counts are added up by applyMerges().
define('aiMerge', async ({ payload, context }) => {
  if (!licenseAllows(context)) throw new Error(UNLICENSED_MESSAGE);
  const startedAt = Date.now();
  const result = await suggestMerges(payload?.report || {});
  console.log(`aiMerge: ${result.model}, ${result.merges.length} merged issues in ${Date.now() - startedAt}ms`);
  return result;
});

// Step 2: broad categories over the merged patterns. Indexes and titles only.
define('aiCategorise', async ({ payload, context }) => {
  if (!licenseAllows(context)) throw new Error(UNLICENSED_MESSAGE);
  const startedAt = Date.now();
  const result = await suggestCategories(payload?.report || {});
  console.log(`aiCategorise: ${result.model}, ${result.categories.length} categories in ${Date.now() - startedAt}ms`);
  return result;
});

define('aiSummary', async ({ payload, context }) => {
  if (!licenseAllows(context)) throw new Error(UNLICENSED_MESSAGE);
  const startedAt = Date.now();
  const result = await summarise(payload?.report || {});
  console.log(`aiSummary: ${result.model}, ${result.patterns.length} patterns in ${Date.now() - startedAt}ms`);
  return result;
});

// Publishing to the customer portal. Jira admins and project admins only.
async function canPublish() {
  const response = await asUser().requestJira(route`/rest/api/3/mypermissions?permissions=ADMINISTER,ADMINISTER_PROJECTS`, { headers: { Accept: 'application/json' } });
  const data = await readJson(response, 'Permission check');
  return Boolean(data.permissions?.ADMINISTER?.havePermission || data.permissions?.ADMINISTER_PROJECTS?.havePermission);
}

/** The organisation as this agent can see it; refuses ids they can't. */
async function visibleOrganisation(orgId) {
  if (!/^\d{1,18}$/.test(String(orgId))) throw new Error('Invalid organisation.');
  const response = await asUser().requestJira(route`/rest/servicedeskapi/organization/${String(orgId)}`, { headers: { Accept: 'application/json' } });
  const data = await readJson(response, 'Organization lookup');
  return { id: String(data.id), name: data.name };
}

// Crew numbers for an analysis (settings → Crew numbers), so the page can show
// tickets per 100 crew: the crew list covering every analysed organisation,
// or null. `covered` lists those of them that are in some crew list, so the
// page can say what to analyse instead. Only organisations this agent can see.
define('getHeadcount', async ({ payload, context }) => {
  if (!licenseAllows(context)) throw new Error(UNLICENSED_MESSAGE);
  const requested = (Array.isArray(payload?.orgIds) ? payload.orgIds : [payload?.orgId]).map(String).slice(0, 10);
  const ids = (await pool(requested.map((id) => () => visibleOrganisation(id)), 4)).map((o) => o.id);
  const { headcounts } = await loadSettings();
  const covered = ids.filter((id) => (headcounts || []).some((h) => orgsOf(h).some((o) => String(o.id) === id)));
  return { headcount: headcountFor(headcounts, ids), covered };
});

// PDF logos: the company's, and the organisation's when the report covers one
// this agent can see.
define('getPdfLogos', async ({ payload, context }) => {
  if (!licenseAllows(context)) throw new Error(UNLICENSED_MESSAGE);
  const company = await loadLogo('company');
  if (!payload?.orgId) return { company, customer: null };
  const organization = await visibleOrganisation(payload.orgId);
  return { company, customer: await loadLogo(organization.id) };
});

// Portal publishing follows each site's admin setting. (Not a Forge variable:
// those apply to every site installed from an environment.)
async function portalEnabled() {
  return (await loadSettings()).portalEnabled === true;
}

define('getPublication', async ({ payload, context }) => {
  if (!licenseAllows(context)) throw new Error(UNLICENSED_MESSAGE);
  if (!(await portalEnabled())) return { portalEnabled: false, canPublish: false, published: null };
  const organization = await visibleOrganisation(payload?.orgId);
  const [allowed, published, liveState] = await Promise.all([canPublish(), loadReport(organization.id), loadLiveState(organization.id)]);
  return { portalEnabled: true, canPublish: allowed, published, liveState };
});

// payload: { snapshot, live: { preset, schedule }, projects }. The agent's
// approved issues, summary and next steps are kept; what customers see (ticket
// examples, trends, breakdowns) is then built by the app from that
// organisation's own tickets, straight away and, with a schedule, on it. The
// page's snapshot (themes and counts only) shows until the build finishes.
define('publishReport', async ({ payload, context }) => {
  if (!licenseAllows(context)) throw new Error(UNLICENSED_MESSAGE);
  if (!(await portalEnabled())) throw new Error('Portal reports are switched off on this site.');
  if (!(await canPublish())) throw new Error('Only Jira admins and project admins can publish to the portal.');
  const organization = await visibleOrganisation(payload?.snapshot?.organization?.id);
  const snapshot = snapshotFrom({ ...payload.snapshot, organization });
  const config = liveConfigFrom({
    ...payload?.live,
    timeZone: payload?.timeZone,
    period: snapshot.period,
    approved: snapshot.patterns.filter((p) => p.title !== 'Other requests'),
    overview: snapshot.overview,
    actions: snapshot.actions,
  }, { organization, projects: payload?.projects });
  snapshot.live = isLive(config) ? { preset: config.preset, schedule: config.schedule } : null;
  config.publishedAt = snapshot.publishedAt;
  config.summaryWrittenAt = snapshot.summaryWrittenAt;
  await saveReport(snapshot);
  await saveLiveConfig(config);
  await queueRefresh(organization.id, 'published');
  console.log(`publishReport: org ${organization.id}, ${snapshot.patterns.length} patterns, ${isLive(config) ? `live ${config.preset}/${config.schedule}` : `one-off ${config.period.from}..${config.period.to}`}`);
  return snapshot;
});

define('refreshLiveReport', async ({ payload, context }) => {
  if (!licenseAllows(context)) throw new Error(UNLICENSED_MESSAGE);
  if (!(await canPublish())) throw new Error('Only Jira admins and project admins can refresh portal reports.');
  const organization = await visibleOrganisation(payload?.orgId);
  if (!isLive(await loadLiveConfig(organization.id))) throw new Error('This portal report isn’t set to keep up to date.');
  await queueRefresh(organization.id, 'agent');
  return loadLiveState(organization.id);
});

define('unpublishReport', async ({ payload, context }) => {
  if (!licenseAllows(context)) throw new Error(UNLICENSED_MESSAGE);
  if (!(await canPublish())) throw new Error('Only Jira admins and project admins can remove portal reports.');
  const organization = await visibleOrganisation(payload?.orgId);
  await Promise.all([deleteReport(organization.id), deleteLive(organization.id)]);
  return { removed: true };
});

// ---- Settings page (jira:adminPage): Jira admins only ------------------------

async function isJiraAdmin() {
  const response = await asUser().requestJira(route`/rest/api/3/mypermissions?permissions=ADMINISTER`, { headers: { Accept: 'application/json' } });
  const data = await readJson(response, 'Permission check');
  return Boolean(data.permissions?.ADMINISTER?.havePermission);
}

async function siteFields() {
  const response = await asUser().requestJira(route`/rest/api/3/field`, { headers: { Accept: 'application/json' } });
  return selectableFields(await readJson(response, 'Field list'));
}

/** The id of the alert ticket's issue type, checked against the project. */
async function alertIssueType({ projectKey, issueTypeName }) {
  if (!projectKey) throw new Error('Enter the key of the Jira project that alert tickets go to, such as SD.');
  return issueTypeIn(projectKey, issueTypeName);
}

/** The id of a (non-subtask) issue type in a project, checked as the signed-in user. */
async function issueTypeIn(projectKey, issueTypeName) {
  const response = await asUser().requestJira(route`/rest/api/3/issue/createmeta/${projectKey}/issuetypes?maxResults=100`, { headers: { Accept: 'application/json' } });
  if (response.status === 404) throw new Error(`Project ${projectKey} wasn’t found, or you can’t create tickets in it.`);
  const data = await readJson(response, 'Issue types');
  const types = (data.issueTypes || data.values || []).filter((t) => !t.subtask);
  const match = types.find((t) => String(t.name).toLowerCase() === issueTypeName.toLowerCase());
  if (!match) throw new Error(`Project ${projectKey} has no “${issueTypeName}” issue type. Available: ${types.map((t) => t.name).join(', ')}.`);
  return String(match.id);
}

// ---- Create problem from a recurring issue ------------------------------------
// Created as the signed-in agent (their Jira permissions, shown as reporter).
// Only structured details come from the page; the description is built here.

define('createProblem', async ({ payload, context }) => {
  if (!licenseAllows(context)) throw new Error(UNLICENSED_MESSAGE);
  const request = problemRequest(payload);
  const [issueTypeId, siteUrl] = await Promise.all([
    issueTypeIn(request.projectKey, request.issueTypeName),
    asUser().requestJira(route`/rest/api/3/serverInfo`, { headers: { Accept: 'application/json' } })
      .then((r) => readJson(r, 'Server info')).then((i) => String(i.baseUrl || '').replace(/\/$/, '')).catch(() => ''),
  ]);
  const response = await asUser().requestJira(route`/rest/api/3/issue`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: problemFields(request, issueTypeId, siteUrl) }),
  });
  const created = await readJson(response, 'Create problem');
  let linked = 0;
  let linkError = '';
  if (request.link && request.keys.length) {
    try {
      const type = relatesLinkType(await readJson(await asUser().requestJira(route`/rest/api/3/issueLinkType`, { headers: { Accept: 'application/json' } }), 'Link types'));
      if (!type) throw new Error('This site has no issue link types.');
      const results = await pool(request.keys.map((key) => async () => {
        const r = await asUser().requestJira(route`/rest/api/3/issueLink`, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: { name: type.name }, inwardIssue: { key: key }, outwardIssue: { key: created.key } }),
        });
        return r.ok;
      }), 4);
      linked = results.filter(Boolean).length;
      if (linked < request.keys.length) linkError = `${request.keys.length - linked} of ${request.keys.length} tickets couldn’t be linked (permissions or links switched off).`;
    } catch (error) {
      linkError = String(error.message || error).slice(0, 200);
    }
  }
  console.log(`createProblem: ${created.key} in ${request.projectKey}, linked ${linked}/${request.link ? request.keys.length : 0}`);
  return { key: created.key, url: siteUrl ? `${siteUrl}/browse/${created.key}` : '', linked, linkError };
});

define('getSettings', async ({ context }) => {
  if (!licenseAllows(context)) throw new Error(UNLICENSED_MESSAGE);
  if (!(await isJiraAdmin())) return { isAdmin: false };
  const [settings, fields, organizations] = await Promise.all([loadSettings(), siteFields(), listOrganizations()]);
  return {
    isAdmin: true,
    settings,
    fields,
    organizations,
  };
});

define('saveSettings', async ({ payload, context }) => {
  if (!licenseAllows(context)) throw new Error(UNLICENSED_MESSAGE);
  if (!(await isJiraAdmin())) throw new Error('Only Jira admins can change Customer Insights settings.');
  const [fields, organizations] = await Promise.all([siteFields(), listOrganizations()]);
  const settings = sanitizeSettings(payload?.settings, fields, organizations);
  if (settings.alerts.createIssue) settings.alerts.issueTypeId = await alertIssueType(settings.alerts);
  if (settings.surge.enabled && settings.surge.createIssue) settings.surge.issueTypeId = await alertIssueType(settings.surge);
  await saveSettings(settings);
  const { alerts } = settings;
  console.log(`saveSettings: ${settings.breakdowns.length} breakdowns, ${settings.headcounts.length} crew lists, surge ${settings.surge.enabled ? `on (${settings.surge.organizations.length} orgs, tickets ${settings.surge.createIssue ? settings.surge.projectKey : 'off'})` : 'off'}, portal ${settings.portalEnabled ? 'on' : 'off'}, alerts ${alerts.enabled ? `on (${alerts.organizations.length} orgs, tickets ${alerts.createIssue ? alerts.projectKey : 'off'})` : 'off'}`);
  return settings;
});

// ---- PDF logos (settings page): Jira admins only -------------------------------

define('getLogos', async ({ context }) => {
  if (!licenseAllows(context)) throw new Error(UNLICENSED_MESSAGE);
  if (!(await isJiraAdmin())) throw new Error('Only Jira admins can change logos.');
  const [company, orgs] = await Promise.all([loadLogo('company'), listOrgLogos()]);
  return { company, orgs };
});

// payload: { target: 'company' | orgId, logo } — a null logo removes it.
define('saveLogo', async ({ payload, context }) => {
  if (!licenseAllows(context)) throw new Error(UNLICENSED_MESSAGE);
  if (!(await isJiraAdmin())) throw new Error('Only Jira admins can change logos.');
  const target = payload?.target === 'company' ? 'company' : String(payload?.target ?? '');
  const logo = payload?.logo ? sanitizeLogo(payload.logo) : null;
  if (payload?.logo && !logo) throw new Error('That image couldn’t be used. Use a PNG or JPEG under about 150 KB.');
  if (target !== 'company') {
    if (!(await listOrganizations()).some((o) => o.id === target)) throw new Error('That organisation wasn’t found.');
    if (logo && !(await loadLogo(target)) && Object.keys(await listOrgLogos()).length >= MAX_ORG_LOGOS) throw new Error(`Up to ${MAX_ORG_LOGOS} organisation logos.`);
  }
  await saveLogo(target, logo);
  console.log(`saveLogo: ${target === 'company' ? 'company' : 'organisation'} ${logo ? `saved (${logo.dataUrl.length} chars)` : 'removed'}`);
  return { target, logo };
});

// ---- Backup & restore (settings page): Jira admins only ---------------------

async function requireBackupAdmin(context) {
  if (!licenseAllows(context)) throw new Error(UNLICENSED_MESSAGE);
  if (!(await isJiraAdmin())) throw new Error('Only Jira admins can back up or restore Customer Insights.');
}

define('exportBackupPage', async ({ payload, context }) => {
  await requireBackupAdmin(context);
  return exportBackupPage(payload?.cursor || null);
});

define('importBackupBatch', async ({ payload, context }) => {
  await requireBackupAdmin(context);
  return importBackupBatch(payload?.items);
});

export const handler = resolver.getDefinitions();
