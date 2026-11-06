import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { getEnv } from '../config/env.js';
import { requireSession, httpError } from '../security/access.js';
import { startConnection, completeConnection, customerId, discoverAccounts, selectAccount } from './client.js';

export async function registerGoogleRoutes(app: FastifyInstance) {
  app.get('/api/google', async request => {
    const { locationId } = await requireSession(request);
    const connected = await pool.query('SELECT connected_at FROM google_connections WHERE location_id=$1', [locationId]);
    const accounts = await pool.query('SELECT customer_id,login_customer_id,name,currency,time_zone,campaign_mappings FROM google_accounts WHERE location_id=$1 ORDER BY name', [locationId]);
    const env = getEnv();
    return { configured: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET), connected: Boolean(connected.rowCount), connectedAt: connected.rows[0]?.connected_at ?? null, accounts: accounts.rows };
  });
  app.post('/api/google/connect', async request => startConnection((await requireSession(request)).locationId));
  app.get('/oauth/google/callback', async (request, reply) => {
    const input = z.object({ state: z.string().max(200), code: z.string().max(2000).optional(), error: z.string().optional() }).parse(request.query);
    await completeConnection(input.state, input.error ? undefined : input.code);
    return reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer').type('text/html').send('<!doctype html><title>Google Ads connected</title><h1>Google Ads connected</h1><p>Return to Xaylo in HighLevel, refresh Settings, and select the advertising accounts to include.</p>');
  });
  app.get('/api/google/accounts', async request => {
    const { locationId } = await requireSession(request);
    const input = z.object({ managerId: customerId.optional() }).strict().parse(request.query);
    return discoverAccounts(locationId, input.managerId);
  });
  app.post('/api/google/accounts', async request => {
    const { locationId } = await requireSession(request);
    const input = z.object({ customerId, loginCustomerId: customerId.nullable().default(null) }).strict().parse(request.body);
    await selectAccount(locationId, input.customerId, input.loginCustomerId);
    return { ok: true };
  });
  app.put('/api/google/accounts/:id/mappings', async request => {
    const { locationId } = await requireSession(request);
    const { id } = z.object({ id: customerId }).parse(request.params);
    const { mappings } = z.object({ mappings: z.record(z.string().min(1).max(200), z.string().regex(/^\d+$/).max(30)).refine(value => Object.keys(value).length <= 200) }).strict().parse(request.body);
    const result = await pool.query('UPDATE google_accounts SET campaign_mappings=$3 WHERE location_id=$1 AND customer_id=$2 RETURNING customer_id', [locationId, id, mappings]);
    if (!result.rowCount) throw httpError(404, 'Google Ads account is not selected for this location');
    return { ok: true };
  });
  app.delete('/api/google/accounts/:id', async request => {
    const { locationId } = await requireSession(request);
    const { id } = z.object({ id: customerId }).parse(request.params);
    await pool.query('DELETE FROM google_accounts WHERE location_id=$1 AND customer_id=$2', [locationId, id]);
    return { ok: true };
  });
  app.delete('/api/google', async request => {
    const { locationId } = await requireSession(request);
    await pool.query('DELETE FROM google_connections WHERE location_id=$1', [locationId]);
    await pool.query('DELETE FROM google_oauth_states WHERE location_id=$1', [locationId]);
    return { ok: true };
  });
}
