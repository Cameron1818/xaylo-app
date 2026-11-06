import { randomBytes, createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { pool } from '../db/pool.js';
import { getEnv, ghlConfigured } from '../config/env.js';
import { assertActive, requireSession, httpError } from '../security/access.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export async function consumeGhlState(state: string) {
  const result = await pool.query('DELETE FROM ghl_oauth_states WHERE state_hash=$1 AND expires_at>now() RETURNING location_id', [hash(state)]);
  if (!result.rows[0]) throw httpError(400, 'HighLevel connection expired; start again from Connections');
  await assertActive(result.rows[0].location_id);
  return result.rows[0].location_id as string;
}
export async function registerGhlRoutes(app: FastifyInstance) {
  app.get('/api/ghl', async request => {
    const { locationId } = await requireSession(request);
    const result = await pool.query("SELECT ghl_location_id FROM installations WHERE location_id=$1 AND status='active'", [locationId]);
    return { configured: ghlConfigured(), connected: Boolean(result.rows[0]?.ghl_location_id), locationId: result.rows[0]?.ghl_location_id || null };
  });
  app.post('/api/ghl/connect', async request => {
    const { locationId } = await requireSession(request);
    const env = getEnv();
    if (!ghlConfigured(env)) throw httpError(503, 'HighLevel integration is not configured');
    const state = randomBytes(32).toString('base64url');
    await pool.query("INSERT INTO ghl_oauth_states(state_hash,location_id,expires_at) VALUES($1,$2,now()+interval '10 minutes')", [hash(state), locationId]);
    const url = new URL('https://marketplace.gohighlevel.com/oauth/chooselocation');
    url.search = new URLSearchParams({ client_id: env.GHL_CLIENT_ID, redirect_uri: `${env.PUBLIC_BASE_URL}/oauth/callback`, response_type: 'code', state,
      scope: 'contacts.readonly contacts.write oauth.write locations.readonly locations/customFields.readonly opportunities.readonly' }).toString();
    return { url: url.toString() };
  });
  app.delete('/api/ghl', async request => {
    const { locationId } = await requireSession(request);
    await pool.query("UPDATE installations SET ghl_location_id=NULL,access_token='',refresh_token='',updated_at=now() WHERE location_id=$1", [locationId]);
    await pool.query('DELETE FROM ghl_oauth_states WHERE location_id=$1', [locationId]);
    await pool.query('DELETE FROM mcp_grants WHERE location_id=$1', [locationId]);
    return { ok: true };
  });
}
