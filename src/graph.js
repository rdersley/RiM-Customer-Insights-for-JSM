// Microsoft Graph: an app-only token (client credentials) and sendMail from the
// admin's sender mailbox. The only outside connection this app makes; the hosts
// are listed in manifest.yml (permissions.external.fetch.backend).
import { fetch } from '@forge/api';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function errorText(response) {
  const body = await response.text().catch(() => '');
  try {
    const data = JSON.parse(body);
    return data.error_description?.split('\r\n')[0] || data.error?.message || data.error || body.slice(0, 200);
  } catch { return body.slice(0, 200); }
}

/** An access token for Graph, as the app registration (tenant, client id, secret). */
export async function graphToken({ tenantId, clientId }, secret) {
  if (!tenantId || !clientId || !secret) throw new Error('Microsoft 365 isn’t set up: add the tenant ID, client ID and client secret in settings.');
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: secret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }).toString(),
  });
  if (!response.ok) throw new Error(`Microsoft sign-in failed (${response.status}): ${await errorText(response)}`);
  return (await response.json()).access_token;
}

/** Sends a Graph sendMail payload from `sender`; retries throttling (429/503) a few times. */
export async function sendMail(token, sender, payload) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (response.status === 202 || response.ok) return;
    if ([429, 503].includes(response.status) && attempt < 3) {
      await sleep(Math.min(10000, (Number(response.headers?.get?.('Retry-After')) || 2 ** attempt) * 1000));
      continue;
    }
    const detail = await errorText(response);
    if (response.status === 403) throw new Error(`Microsoft refused to send as ${sender} (403): ${detail}. Check the app registration has the Mail.Send application permission with admin consent, and may send from that mailbox.`);
    throw new Error(`Sending the email failed (${response.status}): ${detail}`);
  }
}
