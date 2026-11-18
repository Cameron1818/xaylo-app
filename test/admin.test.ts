import './helpers/env.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import { pool } from '../src/db/pool.js';
import { buildApp } from '../src/http/app.js';
import { encrypt, signToken } from '../src/security/crypto.js';
import { getEnv } from '../src/config/env.js';
import { aiConfig } from '../src/admin/settings.js';

const ADMIN_ROUTES: [string, string][] = [['GET', '/api/admin/accounts'], ['GET', '/api/admin/accounts/x'], ['POST', '/api/admin/accounts/x/suspend'], ['DELETE', '/api/admin/accounts/x'],
  ['GET', '/api/admin/users'], ['GET', '/api/admin/payments'], ['GET', '/api/admin/settings'], ['PUT', '/api/admin/settings'], ['GET', '/api/admin/audit'], ['GET', '/api/admin/accounts/x/billing']];

test('admin API rejects unauthenticated requests', async () => {
  const app = await buildApp();
  try { for (const [method, url] of ADMIN_ROUTES) assert.equal((await app.inject({ method: method as 'GET', url, ...(method === 'GET' ? {} : { payload: {} }) })).statusCode, 401, `${method} ${url}`); }
  finally { await app.close(); }
});

const enabled = Boolean(process.env.TEST_DATABASE_URL);
test('admin API: access control, accounts, suspension and settings', { skip: !enabled }, async () => {
  for (const file of (await readdir(new URL('../migrations/', import.meta.url))).sort()) await pool.query(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const app = await buildApp();
  const env = getEnv();
  const adminId = randomUUID(), userId = randomUUID(), locationId = randomUUID();
  const adminEmail = 'cameron@swan-pay.com', userEmail = `user-${userId}@example.com`;
  const bearer = (id: string, location: string) => ({ authorization: `Bearer ${signToken({ kind: 'session', locationId: location, userId: id, accountSessionId: sessions[id] }, env.SESSION_SECRET, 3600)}` });
  const sessions: Record<string, string> = { [adminId]: randomUUID(), [userId]: randomUUID() };
  const adminLocation = randomUUID();
  try {
    await pool.query('DELETE FROM app_users WHERE email=$1', [adminEmail]);
    for (const [id, email, location] of [[adminId, adminEmail, adminLocation], [userId, userEmail, locationId]]) {
      await pool.query(`INSERT INTO installations(location_id,access_token,refresh_token,expires_at,site_key) VALUES($1,'','',now()+interval '1 day',$2)`, [location, randomBytes(24).toString('hex')]);
      await pool.query('INSERT INTO app_users(id,email) VALUES($1,$2)', [id, email]);
      await pool.query("INSERT INTO workspace_members(user_id,location_id,role) VALUES($1,$2,'owner')", [id, location]);
      await pool.query("INSERT INTO account_sessions(id,user_id,location_id,refresh_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '1 day')", [sessions[id], id, location, randomBytes(8).toString('hex')]);
    }
    const admin = bearer(adminId, adminLocation), user = bearer(userId, locationId);

    // Non-admins are forbidden from every admin route; /me reports their status without erroring.
    for (const [method, url] of ADMIN_ROUTES) assert.equal((await app.inject({ method: method as 'GET', url, headers: user, ...(method === 'GET' ? {} : { payload: {} }) })).statusCode, 403, `${method} ${url}`);
    assert.deepEqual((await app.inject({ url: '/api/admin/me', headers: user })).json(), { isAdmin: false });
    assert.deepEqual((await app.inject({ url: '/api/admin/me', headers: admin })).json(), { isAdmin: true });
    // GHL-style sessions with non-uuid user ids are never admin and do not error.
    const ghl = { authorization: `Bearer ${signToken({ kind: 'session', locationId, userId: 'ghl-user', ghlLocationId: 'nope' }, env.SESSION_SECRET, 3600)}` };
    assert.ok([401, 403].includes((await app.inject({ url: '/api/admin/accounts', headers: ghl })).statusCode));

    const list = (await app.inject({ url: `/api/admin/accounts?q=${encodeURIComponent(userEmail)}`, headers: admin })).json();
    assert.equal(list.accounts.length, 1);
    assert.equal(list.accounts[0].location_id, locationId);
    assert.deepEqual(list.accounts[0].emails, [userEmail]);
    assert.equal((await app.inject({ url: `/api/admin/accounts/${locationId}`, headers: admin })).json().members[0].email, userEmail);
    assert.equal((await app.inject({ url: '/api/admin/accounts/missing', headers: admin })).statusCode, 404);
    assert.equal((await app.inject({ url: `/api/admin/users?q=${encodeURIComponent(userEmail)}`, headers: admin })).json().users[0].isAdmin, false);

    // Suspending blocks the workspace immediately and revokes its sessions; unsuspending restores access to the workspace.
    assert.equal((await app.inject({ url: '/api/journeys', headers: user })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: `/api/admin/accounts/${locationId}/suspend`, headers: admin })).statusCode, 200);
    assert.equal((await app.inject({ url: '/api/journeys', headers: user })).statusCode, 403);
    assert.equal((await pool.query('SELECT 1 FROM account_sessions WHERE location_id=$1', [locationId])).rowCount, 0);
    assert.equal((await app.inject({ method: 'POST', url: `/api/admin/accounts/${locationId}/unsuspend`, headers: admin })).statusCode, 200);
    assert.equal((await pool.query('SELECT suspended_at FROM installations WHERE location_id=$1', [locationId])).rows[0].suspended_at, null);

    // Deletion needs the typed id, and admin users are protected.
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/admin/accounts/${locationId}`, headers: admin, payload: { confirm: 'wrong' } })).statusCode, 400);
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/admin/users/${adminId}`, headers: admin })).statusCode, 409);
    assert.equal((await app.inject({ method: 'POST', url: `/api/admin/users/${userId}/revoke-sessions`, headers: admin })).statusCode, 200);

    // Trial extension moves the expiry forward from the later of now and the current expiry.
    const before = new Date((await pool.query('SELECT trial_started_at FROM installations WHERE location_id=$1', [adminLocation])).rows[0].trial_started_at).getTime() + env.FREE_TRIAL_DAYS * 86400000;
    const extended = (await app.inject({ method: 'POST', url: `/api/admin/accounts/${adminLocation}/billing/extend-trial`, headers: admin, payload: { days: 5 } })).json();
    assert.ok(Math.abs(new Date(extended.trialExpiresAt).getTime() - (Math.max(before, Date.now()) + 5 * 86400000)) < 5000);

    // The AI key is stored encrypted, returned masked, preferred over the environment, and clearable.
    assert.equal((await app.inject({ url: '/api/admin/settings', headers: admin })).json().ai.keySource, 'env');
    const secret = 'sk-db-secret-1234';
    assert.equal((await app.inject({ method: 'PUT', url: '/api/admin/settings', headers: admin, payload: { aiApiKey: secret, aiModel: 'db-model' } })).statusCode, 200);
    const stored = (await pool.query("SELECT value,encrypted FROM app_settings WHERE key='ai_api_key'")).rows[0];
    assert.equal(stored.encrypted, true);
    assert.ok(!stored.value.includes('secret'));
    const view = (await app.inject({ url: '/api/admin/settings', headers: admin })).json();
    assert.equal(view.ai.keySource, 'db');
    assert.equal(view.ai.model, 'db-model');
    assert.ok(!JSON.stringify(view).includes(secret));
    assert.deepEqual(await aiConfig().then(({ apiKey, model }) => ({ apiKey, model })), { apiKey: secret, model: 'db-model' });
    assert.equal((await app.inject({ method: 'PUT', url: '/api/admin/settings', headers: admin, payload: { aiApiKey: '', aiModel: '' } })).statusCode, 200);
    assert.equal((await aiConfig()).apiKey, env.OPENAI_API_KEY);
    assert.equal((await app.inject({ method: 'PUT', url: '/api/admin/settings', headers: admin, payload: { unknown: 1 } })).statusCode, 400);

    // Every mutation above was audited, and no secret reached the log.
    const entries = (await app.inject({ url: '/api/admin/audit', headers: admin })).json().entries;
    const actions = entries.map((e: { action: string }) => e.action);
    for (const action of ['account.suspend', 'account.unsuspend', 'user.revoke_sessions', 'billing.extend_trial', 'settings.update']) assert.ok(actions.includes(action), action);
    assert.ok(!JSON.stringify(entries).includes(secret));

    // Deleting the account cascades.
    assert.equal((await app.inject({ method: 'DELETE', url: `/api/admin/accounts/${locationId}`, headers: admin, payload: { confirm: locationId } })).statusCode, 200);
    assert.equal((await pool.query('SELECT 1 FROM installations WHERE location_id=$1', [locationId])).rowCount, 0);
  } finally {
    await pool.query('DELETE FROM app_settings');
    await pool.query('DELETE FROM installations WHERE location_id=ANY($1)', [[locationId, adminLocation]]);
    await pool.query('DELETE FROM app_users WHERE id=ANY($1)', [[adminId, userId]]);
    await pool.query("DELETE FROM admin_audit WHERE admin_email=$1", [adminEmail]);
    await app.close();
  }
});
