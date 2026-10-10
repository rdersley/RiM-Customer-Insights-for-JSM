// Published report storage (Forge KVS). Loaded on first use, like @forge/llm,
// so modules that import this file still load in tests.
import { reportKey } from './publish.js';
import { DEFAULT_SETTINGS } from './settings.js';
import { logoKey } from './logos.js';

const kvs = async () => (await import('@forge/kvs')).kvs;

export async function loadReport(orgId) {
  return (await (await kvs()).get(reportKey(orgId))) || null;
}

export async function saveReport(snapshot) {
  await (await kvs()).set(reportKey(snapshot.organization.id), snapshot);
  return snapshot;
}

export async function deleteReport(orgId) {
  await (await kvs()).delete(reportKey(orgId));
}

// Live reports: the agent's approved settings, and refresh bookkeeping.
const liveKey = (orgId) => `live-config:${reportKey(orgId).split(':')[1]}`;
const stateKey = (orgId) => `live-state:${reportKey(orgId).split(':')[1]}`;

export async function loadLiveConfig(orgId) {
  return (await (await kvs()).get(liveKey(orgId))) || null;
}

export async function saveLiveConfig(config) {
  await (await kvs()).set(liveKey(config.organization.id), config);
}

export async function deleteLive(orgId) {
  const store = await kvs();
  await Promise.all([store.delete(liveKey(orgId)), store.delete(stateKey(orgId))]);
}

export async function loadLiveState(orgId) {
  return (await (await kvs()).get(stateKey(orgId))) || {};
}

export async function updateLiveState(orgId, change) {
  const state = { ...(await loadLiveState(orgId)), ...change };
  await (await kvs()).set(stateKey(orgId), state);
  return state;
}

/** Every live report config, following cursors. */
export async function listLiveConfigs() {
  const { kvs: store, WhereConditions } = await import('@forge/kvs');
  const configs = [];
  let cursor;
  do {
    let query = store.query().where('key', WhereConditions.beginsWith('live-config:')).limit(50);
    if (cursor) query = query.cursor(cursor);
    const page = await query.getMany();
    configs.push(...page.results.map((r) => r.value));
    cursor = page.nextCursor;
  } while (cursor);
  return configs;
}

const SETTINGS_KEY = 'app-settings';

export async function loadSettings() {
  return { ...DEFAULT_SETTINGS, ...((await (await kvs()).get(SETTINGS_KEY)) || {}) };
}

export async function saveSettings(settings) {
  await (await kvs()).set(SETTINGS_KEY, settings);
  return settings;
}

// Spike alerts (src/alerts.js): one key per alert, and per-organisation check state.
const alertKey = (id) => `alert:${String(id).replace(/[^0-9a-z-]/gi, '')}`;
const alertStateKey = (orgId) => `alert-state:${String(orgId).replace(/\D/g, '')}`;

export async function loadAlertState(orgId) {
  return (await (await kvs()).get(alertStateKey(orgId))) || {};
}

export async function saveAlertState(orgId, state) {
  await (await kvs()).set(alertStateKey(orgId), state);
}

export async function saveAlert(alert) {
  await (await kvs()).set(alertKey(alert.id), alert);
}

/** Merges a change into a stored alert (surges grow while they last). */
export async function updateAlert(id, change) {
  const alert = await loadAlert(id);
  if (alert) await saveAlert({ ...alert, ...change });
}

// PDF logos (src/logos.js): 'company', or an organisation id.
export async function loadLogo(target) {
  return (await (await kvs()).get(logoKey(target))) || null;
}

export async function saveLogo(target, logo) {
  if (logo) await (await kvs()).set(logoKey(target), logo);
  else await (await kvs()).delete(logoKey(target));
}

/** Every organisation logo: { orgId: logo }. */
export async function listOrgLogos() {
  const { kvs: store, WhereConditions } = await import('@forge/kvs');
  const logos = {};
  let cursor;
  do {
    let query = store.query().where('key', WhereConditions.beginsWith('logo:org:')).limit(20);
    if (cursor) query = query.cursor(cursor);
    const page = await query.getMany();
    for (const { key, value } of page.results) logos[key.slice('logo:org:'.length)] = value;
    cursor = page.nextCursor;
  } while (cursor);
  return logos;
}

// Live surge detection (src/surge.js): open surges per organisation.
const surgeStateKey = (orgId) => `surge-state:${String(orgId).replace(/D/g, '')}`;

export async function loadSurgeState(orgId) {
  return (await (await kvs()).get(surgeStateKey(orgId))) || {};
}

export async function saveSurgeState(orgId, state) {
  await (await kvs()).set(surgeStateKey(orgId), state);
}

export async function loadAlert(id) {
  return (await (await kvs()).get(alertKey(id))) || null;
}

export async function deleteAlert(id) {
  await (await kvs()).delete(alertKey(id));
}

/** Every stored alert, newest first. */
export async function listAlerts() {
  const { kvs: store, WhereConditions } = await import('@forge/kvs');
  const alerts = [];
  let cursor;
  do {
    let query = store.query().where('key', WhereConditions.beginsWith('alert:')).limit(50);
    if (cursor) query = query.cursor(cursor);
    const page = await query.getMany();
    alerts.push(...page.results.map((r) => r.value));
    cursor = page.nextCursor;
  } while (cursor);
  return alerts.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/**
 * Removes account ids older versions stored (a report's publishedBy, an
 * alert's dismissedBy). The app keeps no personal data, so there is nothing
 * to report to Atlassian's personal data API. Returns how many were cleaned.
 */
export async function scrubAccountIds() {
  const { kvs: store, WhereConditions } = await import('@forge/kvs');
  let cleaned = 0;
  for (const [prefix, field] of [['published-report:', 'publishedBy'], ['alert:', 'dismissedBy']]) {
    let cursor;
    do {
      let query = store.query().where('key', WhereConditions.beginsWith(prefix)).limit(50);
      if (cursor) query = query.cursor(cursor);
      const page = await query.getMany();
      for (const { key, value } of page.results) {
        if (value && field in value) {
          const { [field]: removed, ...rest } = value;
          await store.set(key, rest);
          cleaned += 1;
        }
      }
      cursor = page.nextCursor;
    } while (cursor);
  }
  return cleaned;
}
