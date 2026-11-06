import { pool } from '../db/pool.js';
import { decrypt, encrypt } from '../security/crypto.js';
import { getEnv, ghlConfigured } from '../config/env.js';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { sourceJson } from '../integrations/http.js';
import { httpError } from '../security/access.js';

const tokenSchema = z.object({
  access_token: z.string(), refresh_token: z.string(), expires_in: z.number(),
  userType: z.string().optional(), locationId: z.string().optional(), companyId: z.string().optional(),
  approvedLocations: z.array(z.string()).optional()
});
export type GhlToken = z.infer<typeof tokenSchema>;
const BASE = 'https://services.leadconnectorhq.com';

async function requestToken(params: Record<string, string>): Promise<GhlToken> {
  const env = getEnv();
  if (!ghlConfigured(env)) throw httpError(503, 'HighLevel integration is not configured');
  const response = await fetch(`${BASE}/oauth/token`, {
    method: 'POST', headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', Version: 'v3' },
    body: new URLSearchParams({ client_id: env.GHL_CLIENT_ID, client_secret: env.GHL_CLIENT_SECRET, ...params })
  });
  if (!response.ok) throw new Error(`GHL token exchange failed (${response.status})`);
  return tokenSchema.parse(await response.json());
}
export function exchangeCode(code: string) {
  const env = getEnv();
  return requestToken({ grant_type: 'authorization_code', code, redirect_uri: new URL('/oauth/callback', env.PUBLIC_BASE_URL).toString() });
}

export function singleApprovedLocation(token: GhlToken): string {
  if (token.userType === 'Location' && token.locationId) return token.locationId;
  if (token.userType !== 'Company' || token.approvedLocations?.length !== 1 || !token.companyId) {
    throw new Error('Select exactly one sub-account for this Xaylo installation');
  }
  return token.approvedLocations[0]!;
}

export async function resolveLocationToken(token: GhlToken): Promise<GhlToken> {
  const locationId = singleApprovedLocation(token);
  if (token.userType === 'Location') return token;
  const response = await fetch(`${BASE}/oauth/location-token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token.access_token}`, Version: 'v3', Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ companyId: token.companyId!, locationId })
  });
  if (!response.ok) throw new Error(`GHL location token exchange failed (${response.status})`);
  return tokenSchema.parse({ ...await response.json(), userType: 'Location', companyId: token.companyId, locationId });
}

export async function saveInstallation(token: GhlToken, workspaceId?: string) {
  if (token.userType !== 'Location' || !token.locationId) throw new Error('Install this app in a sub-account/location');
  const env = getEnv();
  const expiresAt = new Date(Date.now() + token.expires_in * 1000);
  const existing = await pool.query('SELECT location_id FROM installations WHERE ghl_location_id=$1', [token.locationId]);
  if (workspaceId && existing.rows[0] && existing.rows[0].location_id !== workspaceId) throw httpError(409, 'This HighLevel location is already linked to a different Xaylo workspace');
  const internalId = workspaceId || existing.rows[0]?.location_id || token.locationId;
  const result = await pool.query<{ site_key: string }>(
    `INSERT INTO installations(location_id, company_id, access_token, refresh_token, expires_at, site_key, ghl_location_id)
     VALUES($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT(location_id) DO UPDATE SET company_id=excluded.company_id, access_token=excluded.access_token,
       refresh_token=excluded.refresh_token, expires_at=excluded.expires_at, ghl_location_id=excluded.ghl_location_id, status='active', updated_at=now()
     RETURNING site_key`,
    [internalId, token.companyId ?? null, encrypt(token.access_token, env.ENCRYPTION_KEY), encrypt(token.refresh_token, env.ENCRYPTION_KEY), expiresAt, randomBytes(24).toString('hex'), token.locationId]
  );
  return result.rows[0]!.site_key;
}

async function getAccessToken(locationId: string): Promise<string> {
  const env = getEnv();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<{ access_token: string; refresh_token: string; expires_at: Date }>(
      "SELECT access_token, refresh_token, expires_at FROM installations WHERE location_id=$1 AND status='active' FOR UPDATE", [locationId]);
    const row = result.rows[0];
    if (!row) throw new Error('Location is not installed');
    if (!row.access_token || !row.refresh_token) throw httpError(409, 'Connect HighLevel in Connections to include CRM data');
    if (row.expires_at.getTime() > Date.now() + 120_000) {
      await client.query('COMMIT');
      return decrypt(row.access_token, env.ENCRYPTION_KEY);
    }
    const refreshed = await requestToken({ grant_type: 'refresh_token', refresh_token: decrypt(row.refresh_token, env.ENCRYPTION_KEY), user_type: 'Location' });
    await client.query('UPDATE installations SET access_token=$2, refresh_token=$3, expires_at=$4, updated_at=now() WHERE location_id=$1',
      [locationId, encrypt(refreshed.access_token, env.ENCRYPTION_KEY), encrypt(refreshed.refresh_token, env.ENCRYPTION_KEY), new Date(Date.now() + refreshed.expires_in * 1000)]);
    await client.query('COMMIT');
    return refreshed.access_token;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export async function addContactTags(locationId: string, contactId: string, tags: string[]) {
  if (!tags.length) return;
  const token = await getAccessToken(locationId);
  const response = await fetch(`${BASE}/contacts/${encodeURIComponent(contactId)}/tags`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, Version: 'v3', 'Content-Type': 'application/json' },
    body: JSON.stringify({ tags })
  });
  if (!response.ok) throw new Error(`GHL tag sync failed (${response.status})`);
}

export async function getContactTags(locationId: string, contactId: string) {
  const token = await getAccessToken(locationId);
  const response = await fetch(`${BASE}/contacts/${encodeURIComponent(contactId)}`, {
    headers: { Authorization: `Bearer ${token}`, Version: 'v3', Accept: 'application/json' }
  });
  if (!response.ok) throw new Error(`GHL contact lookup failed (${response.status})`);
  const { contact } = z.object({ contact: z.object({ locationId: z.string(), tags: z.array(z.string()).optional() }) }).parse(await response.json());
  if (contact.locationId !== await ghlLocationId(locationId)) throw new Error('Contact belongs to another location');
  return contact.tags ?? [];
}

/** A reader captures only this location's token and never accepts an external URL. */
export async function ghlReader(locationId: string) {
  const token = await getAccessToken(locationId);
  return <T>(path: string, body?: object) => sourceJson<T>('HighLevel', `${BASE}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, Version: 'v3', Accept: 'application/json', 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
}

export async function ghlLocationId(workspaceId: string): Promise<string> {
  const result = await pool.query("SELECT ghl_location_id FROM installations WHERE location_id=$1 AND status='active'", [workspaceId]);
  if (!result.rows[0]?.ghl_location_id) throw httpError(409, 'Connect HighLevel in Connections to include CRM data');
  return result.rows[0].ghl_location_id;
}
