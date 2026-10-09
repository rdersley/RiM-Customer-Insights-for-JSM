// Forge handler for live surge detection (src/surge.js): every five minutes,
// checks each watched organisation's tickets from the admin's window. Reads and
// writes Jira as the app, like the other background jobs.
import { asApp, route } from '@forge/api';
import { countIssues, pool, readJson, requestWithRetry, searchPage } from './engine.js';
import { relatesLinkType } from './problem.js';
import { checkSurges } from './surge.js';
import * as storage from './storage.js';

const json = { Accept: 'application/json', 'Content-Type': 'application/json' };
const post = (path, body) => requestWithRetry(() => asApp().requestJira(path, { method: 'POST', headers: json, body: JSON.stringify(body) }));

/** Jira calls for checkSurges, as the app. */
async function appJira() {
  let siteUrl = '';
  try {
    const info = await readJson(await asApp().requestJira(route`/rest/api/3/serverInfo`, { headers: { Accept: 'application/json' } }), 'Server info');
    siteUrl = String(info.baseUrl || '').replace(/\/$/, '');
  } catch { /* links in the ticket are left out */ }
  let linkType;
  return {
    siteUrl,
    async search(jql, max, fields) {
      const issues = [];
      let token;
      do {
        const page = await searchPage(jql, 100, token, fields, 'app');
        issues.push(...page.issues);
        token = page.nextPageToken;
      } while (token && issues.length < max);
      return issues.slice(0, max);
    },
    count: (jql) => countIssues(jql, 'app'),
    async createIssue(fields) {
      return (await readJson(await post(route`/rest/api/3/issue`, { fields }), 'Create incident ticket')).key;
    },
    async link(issueKey, keys) {
      if (!keys.length) return 0;
      linkType ??= relatesLinkType(await readJson(await asApp().requestJira(route`/rest/api/3/issueLinkType`, { headers: { Accept: 'application/json' } }), 'Link types'));
      if (!linkType) return 0;
      const results = await pool(keys.map((key) => async () => (await post(route`/rest/api/3/issueLink`, { type: { name: linkType.name }, inwardIssue: { key }, outwardIssue: { key: issueKey } })).ok), 4);
      return results.filter(Boolean).length;
    },
    async comment(issueKey, body) {
      const response = await post(route`/rest/api/3/issue/${issueKey}/comment`, { body });
      if (!response.ok) throw new Error(`Comment on ${issueKey} failed (${response.status}).`);
    },
  };
}

export const scheduler = async () => {
  const settings = await storage.loadSettings();
  const config = settings.surge;
  if (!config?.enabled || !config.organizations?.length) return;
  const startedAt = Date.now();
  const jira = await appJira();
  await pool(config.organizations.map((organization) => async () => {
    try {
      const { tickets, results } = await checkSurges(organization, settings, { jira, store: storage });
      if (results.length) console.log(`surge: ${organization.id} ${tickets} recent tickets, ${JSON.stringify(results)}`);
    } catch (error) {
      console.error(`surge: check failed for ${organization.id}: ${error.message}`);
      const state = await storage.loadSurgeState(organization.id);
      await storage.saveSurgeState(organization.id, { ...state, checkedAt: new Date().toISOString(), lastError: String(error.message).slice(0, 300) });
    }
  }), 3);
  console.log(`surge: checked ${config.organizations.length} in ${Date.now() - startedAt}ms`);
};
