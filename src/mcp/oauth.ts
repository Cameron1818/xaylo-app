import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { getEnv } from '../config/env.js';
import { bearer, requireSession, httpError } from '../security/access.js';
import { readToken, signToken } from '../security/crypto.js';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
export function validRedirect(value: string) {
  try { const url = new URL(value); return !url.hash && !url.username && !url.password && (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))); }
  catch { return false; }
}
const scopeSchema = z.string().max(100).default('reports:read').refine(value => {
  const scopes = value.split(' '); return scopes.includes('reports:read') && scopes.every(item => ['reports:read', 'reports:generate'].includes(item));
}, 'Unsupported scope');
export async function mcpIdentity(headers: Record<string, unknown>) {
  const token = bearer(headers);
  if (!token) throw httpError(401, 'MCP authorization required');
  const result = await pool.query(`SELECT g.id,g.location_id,g.user_id,g.scope FROM mcp_grants g JOIN installations i ON i.location_id=g.location_id
    WHERE g.access_hash=$1 AND g.access_expires_at>now() AND g.expires_at>now() AND i.status='active'`, [digest(token)]);
  const row = result.rows[0];
  if (!row) throw httpError(401, 'MCP authorization expired or revoked');
  return { locationId: row.location_id as string, userId: row.user_id as string, scopes: (row.scope as string).split(' '), grantId: row.id as string };
}
export function verifyPkce(verifier: string, challenge: string) {
  return /^[A-Za-z0-9._~-]{43,128}$/.test(verifier) && createHash('sha256').update(verifier).digest('base64url') === challenge;
}
export async function registerMcpOAuth(app: FastifyInstance) {
  const env = getEnv();
  const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const resource = `${base}/mcp`;
  if (!app.hasContentTypeParser('application/x-www-form-urlencoded')) app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))));
  app.get('/.well-known/oauth-protected-resource/mcp', async () => ({ resource, authorization_servers: [base], scopes_supported: ['reports:read', 'reports:generate'], bearer_methods_supported: ['header'] }));
  app.get('/.well-known/oauth-authorization-server', async () => ({ issuer: base, authorization_endpoint: `${base}/oauth/mcp/authorize`, token_endpoint: `${base}/oauth/mcp/token`,
    registration_endpoint: `${base}/oauth/mcp/register`, revocation_endpoint: `${base}/oauth/mcp/revoke`, response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'], code_challenge_methods_supported: ['S256'], scopes_supported: ['reports:read', 'reports:generate'] }));
  app.post('/oauth/mcp/register', { config: { rateLimit: { max: 10, timeWindow: '1 hour' } } }, async (request, reply) => {
    const input = z.object({ client_name: z.string().trim().min(1).max(100).default('MCP client'), redirect_uris: z.array(z.string().max(2000).refine(validRedirect)).min(1).max(10),
      token_endpoint_auth_method: z.literal('none').optional(), grant_types: z.array(z.enum(['authorization_code', 'refresh_token'])).optional(), response_types: z.array(z.literal('code')).optional() }).parse(request.body);
    const id = randomUUID();
    await pool.query('INSERT INTO mcp_clients(id,name,redirect_uris) VALUES($1,$2,$3)', [id, input.client_name, input.redirect_uris]);
    return reply.code(201).send({ client_id: id, client_name: input.client_name, redirect_uris: input.redirect_uris, token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] });
  });
  app.get('/oauth/mcp/authorize', async (request, reply) => {
    const input = z.object({ client_id: z.string().uuid(), response_type: z.literal('code'), redirect_uri: z.string().max(2000), state: z.string().max(2000).default(''),
      code_challenge: z.string().regex(/^[A-Za-z0-9_-]{43}$/), code_challenge_method: z.literal('S256'), scope: scopeSchema, resource: z.literal(resource) }).parse(request.query);
    const client = await pool.query('SELECT name,redirect_uris FROM mcp_clients WHERE id=$1', [input.client_id]);
    if (!client.rows[0]?.redirect_uris.includes(input.redirect_uri)) throw httpError(400, 'Unregistered redirect URI');
    const id = randomUUID();
    const userCode = randomBytes(6).toString('hex').toUpperCase();
    await pool.query(`INSERT INTO mcp_authorizations(id,user_code,client_id,redirect_uri,state,challenge,scope,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '10 minutes')`,
      [id, userCode, input.client_id, input.redirect_uri, input.state, input.code_challenge, input.scope]);
    const cookie = signToken({ kind: 'mcp-authorization', id }, env.SESSION_SECRET, 600);
    reply.header('Set-Cookie', `xaylo-mcp=${cookie}; Path=/oauth/mcp/status; HttpOnly; SameSite=Strict; Max-Age=600${base.startsWith('https:') ? '; Secure' : ''}`);
    return reply.header('Cache-Control', 'no-store').header('Referrer-Policy', 'no-referrer').header('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'")
      .type('text/html').send(`<!doctype html><meta name="viewport" content="width=device-width"><title>Connect Xaylo reporting</title><style>body{font:18px system-ui;max-width:650px;margin:10vh auto;padding:24px;background:#10111d;color:#eef0ff}code{font-size:30px;color:#e8b923}p{line-height:1.6}</style><h1>Connect Xaylo reporting</h1><p>Open Xaylo, go to Connections, and enter this code. Review the requesting app and permissions before approving.</p><p><code>${userCode}</code></p><p>Approve only a connection you started. This page will continue automatically. The code expires in ten minutes.</p><p id="status"></p><script>let busy=false;const timer=setInterval(async()=>{if(busy)return;busy=true;try{const r=await fetch('/oauth/mcp/status');const d=await r.json();if(d.redirect){clearInterval(timer);location.replace(d.redirect)}else if(!r.ok){clearInterval(timer);document.getElementById('status').textContent='This request expired. Start the connection again.'}}catch{}finally{busy=false}},2000)</script>`);
  });
  app.get('/oauth/mcp/status', async (request, reply) => {
    const cookie = request.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith('xaylo-mcp='))?.slice('xaylo-mcp='.length) || '';
    const pending = readToken<{ kind: string; id: string }>(cookie, env.SESSION_SECRET);
    if (!pending || pending.kind !== 'mcp-authorization') throw httpError(401, 'Authorization request expired');
    const code = secret();
    const row = (await pool.query(`UPDATE mcp_authorizations SET issued=true,code_hash=$2 WHERE id=$1 AND location_id IS NOT NULL AND NOT issued AND expires_at>now() RETURNING redirect_uri,state`, [pending.id, digest(code)])).rows[0];
    reply.header('Cache-Control', 'no-store');
    if (!row) {
      const exists = await pool.query('SELECT 1 FROM mcp_authorizations WHERE id=$1 AND expires_at>now() AND NOT issued', [pending.id]);
      if (!exists.rowCount) throw httpError(400, 'Authorization request expired');
      return { pending: true };
    }
    const url = new URL(row.redirect_uri); url.searchParams.set('code', code); if (row.state) url.searchParams.set('state', row.state);
    reply.header('Set-Cookie', 'xaylo-mcp=; Path=/oauth/mcp/status; HttpOnly; SameSite=Strict; Max-Age=0');
    return { redirect: url.toString() };
  });
  app.get('/api/mcp/requests/:code', async request => {
    await requireSession(request);
    const { code } = z.object({ code: z.string().regex(/^[A-Fa-f0-9]{12}$/) }).parse(request.params);
    const row = (await pool.query(`SELECT c.name,c.redirect_uris,a.scope,a.redirect_uri FROM mcp_authorizations a JOIN mcp_clients c ON c.id=a.client_id WHERE a.user_code=$1 AND a.location_id IS NULL AND a.expires_at>now()`, [code.toUpperCase()])).rows[0];
    if (!row) throw httpError(404, 'Connection code is invalid or expired');
    return { clientName: row.name, redirectUri: row.redirect_uri, scope: row.scope };
  });
  app.post('/api/mcp/approve', async request => {
    const session = await requireSession(request);
    const { code } = z.object({ code: z.string().regex(/^[A-Fa-f0-9]{12}$/) }).strict().parse(request.body);
    const result = await pool.query(`UPDATE mcp_authorizations SET location_id=$2,user_id=$3 WHERE user_code=$1 AND location_id IS NULL AND expires_at>now() RETURNING id`, [code.toUpperCase(), session.locationId, session.userId]);
    if (!result.rowCount) throw httpError(400, 'Connection code is invalid or expired');
    return { ok: true };
  });
  app.post('/oauth/mcp/token', async (request, reply) => {
    const input = z.object({ grant_type: z.enum(['authorization_code', 'refresh_token']), client_id: z.string().uuid(), resource: z.literal(resource),
      code: z.string().max(200).optional(), redirect_uri: z.string().max(2000).optional(), code_verifier: z.string().max(128).optional(), refresh_token: z.string().max(200).optional() }).parse(request.body);
    const accessToken = secret(), refreshToken = secret();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let scope: string;
      if (input.grant_type === 'authorization_code') {
        const row = (await client.query(`SELECT a.* FROM mcp_authorizations a JOIN installations i ON i.location_id=a.location_id
          WHERE a.code_hash=$1 AND a.client_id=$2 AND a.expires_at>now() AND a.issued AND i.status='active' FOR UPDATE OF a`, [digest(input.code || ''), input.client_id])).rows[0];
        if (!row || row.redirect_uri !== input.redirect_uri || !verifyPkce(input.code_verifier || '', row.challenge)) throw httpError(400, 'Invalid authorization grant');
        scope = row.scope;
        await client.query('DELETE FROM mcp_authorizations WHERE id=$1', [row.id]);
        await client.query(`INSERT INTO mcp_grants(id,client_id,location_id,user_id,scope,access_hash,refresh_hash,access_expires_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '1 hour',now()+interval '90 days')`,
          [randomUUID(), input.client_id, row.location_id, row.user_id, scope, digest(accessToken), digest(refreshToken)]);
      } else {
        const row = (await client.query(`SELECT g.id,g.scope FROM mcp_grants g JOIN installations i ON i.location_id=g.location_id
          WHERE g.refresh_hash=$1 AND g.client_id=$2 AND g.expires_at>now() AND i.status='active' FOR UPDATE OF g`, [digest(input.refresh_token || ''), input.client_id])).rows[0];
        if (!row) throw httpError(400, 'Invalid refresh grant');
        scope = row.scope;
        await client.query("UPDATE mcp_grants SET access_hash=$2,refresh_hash=$3,access_expires_at=now()+interval '1 hour' WHERE id=$1", [row.id, digest(accessToken), digest(refreshToken)]);
      }
      await client.query('COMMIT');
      return reply.header('Cache-Control', 'no-store').send({ access_token: accessToken, refresh_token: refreshToken, token_type: 'Bearer', expires_in: 3600, scope });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof Error && 'statusCode' in error && error.statusCode === 400) return reply.code(400).send({ error: 'invalid_grant', error_description: error.message });
      throw error;
    } finally { client.release(); }
  });
  app.post('/oauth/mcp/revoke', async request => {
    const input = z.object({ client_id: z.string().uuid(), token: z.string().max(200) }).parse(request.body);
    await pool.query('DELETE FROM mcp_grants WHERE client_id=$1 AND (access_hash=$2 OR refresh_hash=$2)', [input.client_id, digest(input.token)]);
    return {};
  });
  app.get('/api/mcp/grants', async request => {
    const { locationId } = await requireSession(request);
    return { grants: (await pool.query('SELECT g.id,c.name,g.scope,g.created_at,g.expires_at FROM mcp_grants g JOIN mcp_clients c ON c.id=g.client_id WHERE g.location_id=$1 AND g.expires_at>now() ORDER BY g.created_at DESC', [locationId])).rows };
  });
  app.delete('/api/mcp/grants/:id', async request => {
    const { locationId } = await requireSession(request);
    const { id } = z.object({ id: z.string().uuid() }).parse(request.params);
    await pool.query('DELETE FROM mcp_grants WHERE location_id=$1 AND id=$2', [locationId, id]);
    return { ok: true };
  });
}
