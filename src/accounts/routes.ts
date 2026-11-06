import { randomBytes, randomUUID, createHash } from 'node:crypto';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { getEnv } from '../config/env.js';
import { signToken } from '../security/crypto.js';
import { httpError, requireSession } from '../security/access.js';
import { sourceJson } from '../integrations/http.js';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const cookieName = 'xaylo-account';
function setCookie(reply: FastifyReply, token: string, expires = 2592000) {
  reply.header('Set-Cookie', `${cookieName}=${token}; Path=/api/auth; HttpOnly; SameSite=Strict; Max-Age=${expires}${getEnv().PUBLIC_BASE_URL.startsWith('https:') ? '; Secure' : ''}`);
}
function sessionToken(row: { id: string; user_id: string; location_id: string }) {
  return signToken({ kind: 'session', locationId: row.location_id, userId: row.user_id, accountSessionId: row.id }, getEnv().SESSION_SECRET, 3600);
}
function sessionCookie(headers: { cookie?: string }) { return headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || ''; }
export async function registerAccountRoutes(app: FastifyInstance) {
  app.post('/api/auth/email', { config: { rateLimit: { max: 5, timeWindow: '15 minutes' } } }, async request => {
    const env = getEnv();
    if (!env.RESEND_API_KEY || !env.EMAIL_FROM) throw httpError(503, 'Email sign-in is not configured. You can still open Xaylo inside HighLevel.');
    const { email } = z.object({ email: z.string().trim().email().max(254).transform(value => value.toLowerCase()) }).strict().parse(request.body);
    const recent = await pool.query("SELECT 1 FROM email_signins WHERE email=$1 AND created_at>now()-interval '1 minute' LIMIT 1", [email]);
    if (recent.rowCount) return { sent: true };
    const token = randomBytes(32).toString('base64url');
    await pool.query("INSERT INTO email_signins(token_hash,email,expires_at) VALUES($1,$2,now()+interval '15 minutes')", [hash(token), email]);
    const link = `${env.PUBLIC_BASE_URL}/app#signin=${token}`;
    try {
      await sourceJson('Email sign-in', 'https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': hash(token) },
        body: JSON.stringify({ from: env.EMAIL_FROM, to: [email], subject: 'Your Xaylo sign-in link', text: `Sign in to Xaylo or create your account:\n\n${link}\n\nThis link expires in 15 minutes and can be used once. If you did not request it, ignore this email.` }) });
    } catch (error) { await pool.query('DELETE FROM email_signins WHERE token_hash=$1', [hash(token)]); throw error; }
    return { sent: true };
  });
  app.post('/api/auth/redeem', async (request, reply) => {
    const { token } = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }).strict().parse(request.body);
    const refreshToken = randomBytes(32).toString('base64url');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const signin = (await client.query('DELETE FROM email_signins WHERE token_hash=$1 AND expires_at>now() RETURNING email', [hash(token)])).rows[0];
      if (!signin) throw httpError(400, 'Sign-in link is invalid or expired. Request another link.');
      // Serialize first sign-in for the same address, even when multiple links exist.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [signin.email]);
      let user = (await client.query('SELECT id FROM app_users WHERE email=$1', [signin.email])).rows[0];
      if (!user) {
        user = { id: randomUUID() };
        const workspaceId = randomUUID();
        await client.query('INSERT INTO app_users(id,email) VALUES($1,$2)', [user.id, signin.email]);
        await client.query(`INSERT INTO installations(location_id,access_token,refresh_token,expires_at,site_key) VALUES($1,'','',now(),$2)`, [workspaceId, randomBytes(24).toString('hex')]);
        await client.query('INSERT INTO workspace_members(user_id,location_id) VALUES($1,$2)', [user.id, workspaceId]);
      }
      const membership = (await client.query("SELECT m.location_id FROM workspace_members m JOIN installations i ON i.location_id=m.location_id WHERE m.user_id=$1 AND i.status='active' ORDER BY i.created_at LIMIT 1", [user.id])).rows[0];
      if (!membership) throw httpError(403, 'No active workspace is available');
      const session = { id: randomUUID(), user_id: user.id as string, location_id: membership.location_id as string };
      await client.query("INSERT INTO account_sessions(id,user_id,location_id,refresh_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '30 days')", [session.id, session.user_id, session.location_id, hash(refreshToken)]);
      await client.query('COMMIT');
      setCookie(reply, refreshToken);
      return { token: sessionToken(session), email: signin.email };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  });
  app.post('/api/auth/session', async (request, reply) => {
    if (request.headers.origin && request.headers.origin !== new URL(getEnv().PUBLIC_BASE_URL).origin) throw httpError(403, 'Origin is not allowed');
    const token = sessionCookie(request.headers);
    if (!token) throw httpError(401, 'Sign in to continue');
    const row = (await pool.query(`SELECT s.id,s.user_id,s.location_id,u.email FROM account_sessions s JOIN app_users u ON u.id=s.user_id
      JOIN installations i ON i.location_id=s.location_id JOIN workspace_members m ON m.user_id=s.user_id AND m.location_id=s.location_id
      WHERE s.refresh_hash=$1 AND s.expires_at>now() AND i.status='active'`, [hash(token)])).rows[0];
    if (!row) { setCookie(reply, '', 0); throw httpError(401, 'Sign in to continue'); }
    return { token: sessionToken(row), email: row.email };
  });
  app.post('/api/auth/logout', async (request, reply) => {
    const session = await requireSession(request);
    if (session.accountSessionId) await pool.query('DELETE FROM account_sessions WHERE id=$1 AND user_id=$2', [session.accountSessionId, session.userId]);
    setCookie(reply, '', 0);
    return { ok: true };
  });
}
