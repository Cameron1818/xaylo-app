import { randomBytes, createHash } from 'node:crypto';
import { pool } from '../db/pool.js';
import { getEnv } from '../config/env.js';
import { decrypt, encrypt } from '../security/crypto.js';
import { assertActive, httpError } from '../security/access.js';
import { sourceJson } from '../integrations/http.js';
import { z } from 'zod';

export const customerId = z.string().regex(/^\d{10}$/);
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const tokenSchema = z.object({ access_token: z.string(), refresh_token: z.string().optional(), expires_in: z.number() });
export type Account = { customer_id: string; login_customer_id: string | null; name: string; currency: string; time_zone: string; campaign_mappings: Record<string, string> };
type GoogleRow = Record<string, any>;

function configured() {
  const env = getEnv();
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw httpError(503, 'Google Ads connection is not configured');
  return env;
}
async function tokenRequest(params: Record<string, string>) {
  const env = configured();
  return tokenSchema.parse(await sourceJson('Google OAuth', 'https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, ...params })
  }));
}
export async function startConnection(locationId: string) {
  const env = configured();
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  await pool.query('INSERT INTO google_oauth_states(state_hash,location_id,verifier,expires_at) VALUES($1,$2,$3,now()+interval \'10 minutes\')',
    [hash(state), locationId, encrypt(verifier, env.ENCRYPTION_KEY)]);
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: `${env.PUBLIC_BASE_URL}/oauth/google/callback`, response_type: 'code',
    scope: 'https://www.googleapis.com/auth/adwords', access_type: 'offline', prompt: 'consent', state,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }).toString();
  return { url: url.toString() };
}
export async function completeConnection(state: string, code?: string) {
  const env = configured();
  const states = await pool.query('DELETE FROM google_oauth_states WHERE state_hash=$1 AND expires_at>now() RETURNING location_id,verifier', [hash(state)]);
  const pending = states.rows[0];
  if (!pending) throw httpError(400, 'Google connection expired; start again from Settings');
  await assertActive(pending.location_id);
  if (!code) throw httpError(400, 'Google connection was declined; start again from Settings');
  const token = await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: `${env.PUBLIC_BASE_URL}/oauth/google/callback`, code_verifier: decrypt(pending.verifier, env.ENCRYPTION_KEY) });
  if (!token.refresh_token) throw httpError(400, 'Google did not grant offline access; reconnect with consent');
  // Reconnecting invalidates old account selections: the newly authorised identity must select again.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO google_connections(location_id,access_token,refresh_token,expires_at) VALUES($1,$2,$3,$4)
      ON CONFLICT(location_id) DO UPDATE SET access_token=excluded.access_token,refresh_token=excluded.refresh_token,expires_at=excluded.expires_at,connected_at=now()`,
      [pending.location_id, encrypt(token.access_token, env.ENCRYPTION_KEY), encrypt(token.refresh_token, env.ENCRYPTION_KEY), new Date(Date.now() + token.expires_in * 1000)]);
    await client.query('DELETE FROM google_accounts WHERE location_id=$1', [pending.location_id]);
    await client.query('COMMIT');
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function accessToken(locationId: string) {
  const env = configured();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT * FROM google_connections WHERE location_id=$1 FOR UPDATE', [locationId]);
    const row = result.rows[0];
    if (!row) throw httpError(409, 'Connect Google Ads in Settings');
    if (new Date(row.expires_at).getTime() > Date.now() + 120_000) { await client.query('COMMIT'); return decrypt(row.access_token, env.ENCRYPTION_KEY); }
    const token = await tokenRequest({ grant_type: 'refresh_token', refresh_token: decrypt(row.refresh_token, env.ENCRYPTION_KEY) });
    await client.query('UPDATE google_connections SET access_token=$2,refresh_token=$3,expires_at=$4 WHERE location_id=$1',
      [locationId, encrypt(token.access_token, env.ENCRYPTION_KEY), token.refresh_token ? encrypt(token.refresh_token, env.ENCRYPTION_KEY) : row.refresh_token, new Date(Date.now() + token.expires_in * 1000)]);
    await client.query('COMMIT');
    return token.access_token;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function headers(locationId: string, loginId?: string | null) {
  const env = getEnv();
  return { Authorization: `Bearer ${await accessToken(locationId)}`, 'Content-Type': 'application/json',
    ...(env.GOOGLE_ADS_DEVELOPER_TOKEN ? { 'developer-token': env.GOOGLE_ADS_DEVELOPER_TOKEN } : {}),
    ...(env.GOOGLE_CLOUD_PROJECT ? { 'x-goog-user-project': env.GOOGLE_CLOUD_PROJECT } : {}),
    ...(loginId ? { 'login-customer-id': customerId.parse(loginId) } : {}) };
}
/** Only internal, fixed GAQL templates call this; never expose arbitrary GAQL to MCP. */
export async function queryGoogle(locationId: string, id: string, loginId: string | null, query: string) {
  const requestHeaders = await headers(locationId, loginId);
  const rows: GoogleRow[] = [];
  let pageToken = '';
  let truncated = false;
  const max = getEnv().REPORT_SOURCE_MAX_PAGES;
  for (let page = 0; page < max; page++) {
    const data = await sourceJson<{ results?: GoogleRow[]; nextPageToken?: string }>('Google Ads',
      `https://googleads.googleapis.com/${getEnv().GOOGLE_ADS_API_VERSION}/customers/${customerId.parse(id)}/googleAds:search`, {
        method: 'POST', headers: requestHeaders, body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) })
      });
    rows.push(...data.results ?? []);
    pageToken = data.nextPageToken ?? '';
    if (!pageToken) break;
    truncated = page === max - 1;
  }
  return { rows, truncated };
}
export async function discoverAccounts(locationId: string, managerId?: string) {
  if (managerId) {
    const { rows, truncated } = await queryGoogle(locationId, customerId.parse(managerId), managerId,
      'SELECT customer_client.id, customer_client.descriptive_name, customer_client.manager, customer_client.currency_code, customer_client.time_zone FROM customer_client WHERE customer_client.level <= 1');
    return { accounts: rows.map(row => ({ id: String(row.customerClient.id), name: row.customerClient.descriptiveName || row.customerClient.id,
      manager: Boolean(row.customerClient.manager), currency: row.customerClient.currencyCode, timeZone: row.customerClient.timeZone, loginCustomerId: managerId })), truncated };
  }
  const data = await sourceJson<{ resourceNames?: string[] }>('Google Ads', `https://googleads.googleapis.com/${getEnv().GOOGLE_ADS_API_VERSION}/customers:listAccessibleCustomers`, { headers: await headers(locationId) });
  return { accounts: (data.resourceNames ?? []).map(name => ({ id: name.split('/').at(-1), name, manager: null, loginCustomerId: null })), truncated: false };
}
export async function selectAccount(locationId: string, id: string, loginId: string | null) {
  const { rows } = await queryGoogle(locationId, id, loginId,
    'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager FROM customer LIMIT 1');
  const customer = rows[0]?.customer;
  if (!customer || String(customer.id) !== id || customer.manager) throw httpError(400, 'Select an advertising account, rather than a manager account');
  await pool.query(`INSERT INTO google_accounts(location_id,customer_id,login_customer_id,name,currency,time_zone) VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(location_id,customer_id) DO UPDATE SET login_customer_id=excluded.login_customer_id,name=excluded.name,currency=excluded.currency,time_zone=excluded.time_zone`,
    [locationId, id, loginId, customer.descriptiveName || id, customer.currencyCode, customer.timeZone]);
}
export async function selectedAccount(locationId: string, id: string): Promise<Account> {
  const result = await pool.query<Account>('SELECT customer_id,login_customer_id,name,currency,time_zone,campaign_mappings FROM google_accounts WHERE location_id=$1 AND customer_id=$2', [locationId, customerId.parse(id)]);
  if (!result.rows[0]) throw httpError(404, 'Google Ads account is not selected for this location');
  return result.rows[0];
}
