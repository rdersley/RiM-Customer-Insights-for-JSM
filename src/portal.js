// Customer portal resolver. Kept separate from the agent resolver (index.js):
// portal customers can call every definition of the function their module
// uses, so this function offers only: read my reports, and ask for a refresh.
import Resolver from '@forge/resolver';
import { asApp, route } from '@forge/api';
import { licenseAllows } from './license.js';
import { portalView } from './publish.js';
import { isLive, nextCustomerRefresh } from './live.js';
import { queueRefresh } from './liveJobs.js';
import { loadLiveConfig, loadLiveState, loadReport, loadSettings, updateLiveState } from './storage.js';

const ResolverClass = Resolver.default ?? Resolver;
const resolver = new ResolverClass();

/** Organisations the signed-in portal user belongs to (read as the app). */
async function organisationsOf(accountId) {
  const ids = [];
  let start = 0;
  for (let page = 0; page < 10; page += 1) {
    const response = await asApp().requestJira(route`/rest/servicedeskapi/organization?accountId=${accountId}&start=${start}&limit=50`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Organisation lookup failed (${response.status}).`);
    const data = await response.json();
    ids.push(...(data.values || []).map((o) => String(o.id)));
    if (data.isLastPage || !data.values?.length) break;
    start += data.values.length;
  }
  return ids;
}

async function available(context) {
  if (!licenseAllows(context)) return false;
  return (await loadSettings()).portalEnabled === true;
}

const viewer = (context) => (context?.accountId && context.accountId !== 'unidentified' ? context.accountId : null);

resolver.define('myReports', async ({ context }) => {
  if (!(await available(context))) return { available: false, reports: [] };
  const accountId = viewer(context);
  if (!accountId) return { available: true, reports: [] };
  const orgIds = await organisationsOf(accountId);
  const reports = await Promise.all(orgIds.map(async (orgId) => {
    const snapshot = await loadReport(orgId);
    if (!snapshot) return null;
    const state = snapshot.live ? await loadLiveState(orgId) : {};
    return {
      ...portalView(snapshot),
      refreshing: Boolean(state.queuedAt),
      nextRefreshAt: snapshot.live ? nextCustomerRefresh(state) || null : null,
    };
  }));
  const list = reports.filter(Boolean).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  return { available: true, reports: list };
});

// At most once an hour per organisation, and only for the viewer's own organisations.
resolver.define('refreshMyReport', async ({ payload, context }) => {
  if (!(await available(context))) throw new Error('Service reports aren’t available.');
  const accountId = viewer(context);
  const orgId = String(payload?.orgId ?? '');
  if (!accountId || !(await organisationsOf(accountId)).includes(orgId)) throw new Error('This report isn’t available to you.');
  if (!isLive(await loadLiveConfig(orgId))) throw new Error('This report isn’t updated automatically.');
  const next = nextCustomerRefresh(await loadLiveState(orgId));
  if (next) return { queued: false, nextRefreshAt: next };
  await updateLiveState(orgId, { requestedAt: new Date().toISOString() });
  await queueRefresh(orgId, 'customer');
  return { queued: true };
});

export const handler = resolver.getDefinitions();
