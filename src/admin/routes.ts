import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { pool } from '../db/pool.js';
import { getEnv } from '../config/env.js';
import { httpError, isAdminEmail, requireAdmin, requireSession, sessionEmail } from '../security/access.js';
import { stripeClient } from '../billing/stripe.js';
import { aiConfig, maskSecret, setSetting } from './settings.js';

const limited = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
const idParam = z.object({ id: z.string().min(1).max(200) }).strict();
const userParam = z.object({ id: z.string().uuid() }).strict();
const paging = z.object({ q: z.string().trim().max(200).default(''), page: z.coerce.number().int().min(0).max(10000).default(0) }).strict();
const PAGE = 25;

async function audit(admin: string, action: string, target: string | null, detail: object = {}) {
  await pool.query('INSERT INTO admin_audit(id,admin_email,action,target,detail) VALUES($1,$2,$3,$4,$5)', [randomUUID(), admin, action, target, detail]);
}
async function stripeCall<T>(operation: (stripe: ReturnType<typeof stripeClient>) => Promise<T>) {
  const stripe = stripeClient();
  try { return await operation(stripe); }
  catch (error) {
    if (error instanceof Error && 'statusCode' in error) throw error;
    throw httpError(502, `Stripe request failed${error instanceof Error && error.message ? `: ${error.message}` : ''}`);
  }
}
async function workspace(id: string) {
  const row = (await pool.query('SELECT location_id,status,stripe_customer_id,stripe_subscription_id,trial_started_at,suspended_at FROM installations WHERE location_id=$1', [id])).rows[0];
  if (!row) throw httpError(404, 'Account not found');
  return row as { location_id: string; status: string; stripe_customer_id: string | null; stripe_subscription_id: string | null; trial_started_at: Date; suspended_at: Date | null };
}

export async function registerAdminRoutes(app: FastifyInstance) {
  // Never throws for non-admins so the dashboard can decide whether to show the Admin tab; every other route enforces access.
  app.get('/api/admin/me', async request => {
    const session = await requireSession(request);
    return { isAdmin: isAdminEmail(await sessionEmail(session.userId)) };
  });

  app.get('/api/admin/accounts', limited, async request => {
    await requireAdmin(request);
    const { q, page } = paging.parse(request.query);
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    const rows = (await pool.query(`SELECT i.location_id,i.status,i.created_at,i.trial_started_at,i.suspended_at,i.stripe_customer_id,i.stripe_subscription_id,i.ghl_location_id IS NOT NULL AS ghl,
        COALESCE((SELECT array_agg(u.email ORDER BY u.email) FROM workspace_members m JOIN app_users u ON u.id=m.user_id WHERE m.location_id=i.location_id),'{}') AS emails,
        (SELECT count(*) FROM reports r WHERE r.location_id=i.location_id) AS reports
      FROM installations i WHERE $1='' OR i.location_id ILIKE $2 OR EXISTS (SELECT 1 FROM workspace_members m JOIN app_users u ON u.id=m.user_id WHERE m.location_id=i.location_id AND u.email ILIKE $2)
      ORDER BY i.created_at DESC LIMIT $3 OFFSET $4`, [q, like, PAGE + 1, page * PAGE])).rows;
    return { accounts: rows.slice(0, PAGE).map(row => ({ ...row, reports: Number(row.reports) })), hasMore: rows.length > PAGE };
  });
  app.get('/api/admin/accounts/:id', limited, async request => {
    await requireAdmin(request);
    const { id } = idParam.parse(request.params);
    const account = (await pool.query(`SELECT location_id,status,created_at,trial_started_at,suspended_at,stripe_customer_id,stripe_subscription_id,ghl_location_id,allowed_origins FROM installations WHERE location_id=$1`, [id])).rows[0];
    if (!account) throw httpError(404, 'Account not found');
    const [members, usage, journeys, audits] = await Promise.all([
      pool.query('SELECT u.id,u.email,m.role FROM workspace_members m JOIN app_users u ON u.id=m.user_id WHERE m.location_id=$1 ORDER BY u.email', [id]),
      pool.query("SELECT window_key,count(*) AS count FROM report_usage WHERE location_id=$1 AND (status='completed' OR expires_at>now()) GROUP BY window_key ORDER BY window_key DESC LIMIT 12", [id]),
      pool.query('SELECT count(*) AS count FROM journeys WHERE location_id=$1', [id]),
      pool.query("SELECT admin_email,action,detail,created_at FROM admin_audit WHERE target=$1 ORDER BY created_at DESC LIMIT 20", [id])]);
    return { account, members: members.rows, usage: usage.rows.map(row => ({ ...row, count: Number(row.count) })), journeys: Number(journeys.rows[0].count), audit: audits.rows };
  });
  for (const suspend of [true, false]) {
    app.post(`/api/admin/accounts/:id/${suspend ? 'suspend' : 'unsuspend'}`, limited, async request => {
      const admin = await requireAdmin(request);
      const { id } = idParam.parse(request.params);
      const result = await pool.query(`UPDATE installations SET suspended_at=${suspend ? 'now()' : 'NULL'} WHERE location_id=$1`, [id]);
      if (!result.rowCount) throw httpError(404, 'Account not found');
      if (suspend) await pool.query('DELETE FROM account_sessions WHERE location_id=$1', [id]);
      await audit(admin.email, suspend ? 'account.suspend' : 'account.unsuspend', id);
      return { ok: true };
    });
  }
  app.delete('/api/admin/accounts/:id', limited, async request => {
    const admin = await requireAdmin(request);
    const { id } = idParam.parse(request.params);
    const { confirm } = z.object({ confirm: z.string() }).strict().parse(request.body);
    if (confirm !== id) throw httpError(400, 'Type the account id to confirm deletion');
    const row = await workspace(id);
    if (row.stripe_subscription_id) throw httpError(409, 'Cancel the subscription before deleting this account');
    await pool.query('DELETE FROM installations WHERE location_id=$1', [id]);
    await audit(admin.email, 'account.delete', id, { stripeCustomerId: row.stripe_customer_id });
    return { ok: true };
  });

  app.get('/api/admin/users', limited, async request => {
    await requireAdmin(request);
    const { q, page } = paging.parse(request.query);
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    const rows = (await pool.query(`SELECT u.id,u.email,u.created_at,
        COALESCE((SELECT array_agg(m.location_id) FROM workspace_members m WHERE m.user_id=u.id),'{}') AS workspaces,
        (SELECT count(*) FROM account_sessions s WHERE s.user_id=u.id AND s.expires_at>now()) AS sessions
      FROM app_users u WHERE $1='' OR u.email ILIKE $2 ORDER BY u.created_at DESC LIMIT $3 OFFSET $4`, [q, like, PAGE + 1, page * PAGE])).rows;
    return { users: rows.slice(0, PAGE).map(row => ({ ...row, sessions: Number(row.sessions), isAdmin: isAdminEmail(row.email) })), hasMore: rows.length > PAGE };
  });
  app.post('/api/admin/users/:id/revoke-sessions', limited, async request => {
    const admin = await requireAdmin(request);
    const { id } = userParam.parse(request.params);
    const result = await pool.query('DELETE FROM account_sessions WHERE user_id=$1', [id]);
    await audit(admin.email, 'user.revoke_sessions', id, { sessions: result.rowCount });
    return { ok: true, revoked: result.rowCount };
  });
  app.delete('/api/admin/users/:id', limited, async request => {
    const admin = await requireAdmin(request);
    const { id } = userParam.parse(request.params);
    const user = (await pool.query('SELECT email FROM app_users WHERE id=$1', [id])).rows[0];
    if (!user) throw httpError(404, 'User not found');
    if (isAdminEmail(user.email)) throw httpError(409, 'Admin users cannot be deleted');
    await pool.query('DELETE FROM app_users WHERE id=$1', [id]);
    await audit(admin.email, 'user.delete', id, { email: user.email });
    return { ok: true };
  });

  app.get('/api/admin/accounts/:id/billing', limited, async request => {
    await requireAdmin(request);
    const row = await workspace(idParam.parse(request.params).id);
    const env = getEnv();
    const base = { customerId: row.stripe_customer_id, subscriptionId: row.stripe_subscription_id, trialStartedAt: row.trial_started_at, freeTrialDays: env.FREE_TRIAL_DAYS };
    if (!row.stripe_customer_id) return { ...base, subscriptions: [], invoices: [] };
    const customer = row.stripe_customer_id;
    return stripeCall(async stripe => {
      const [subscriptions, invoices] = await Promise.all([stripe.subscriptions.list({ customer, status: 'all', limit: 10 }), stripe.invoices.list({ customer, limit: 10 })]);
      return { ...base,
        subscriptions: subscriptions.data.map(s => ({ id: s.id, status: s.status, cancelAtPeriodEnd: s.cancel_at_period_end, currentPeriodEnd: Math.max(0, ...s.items.data.map(i => i.current_period_end)) * 1000 || null, created: s.created * 1000 })),
        invoices: invoices.data.map(i => ({ id: i.id, number: i.number, status: i.status, amountPaid: i.amount_paid, amountDue: i.amount_due, currency: i.currency, created: i.created * 1000, url: i.hosted_invoice_url })) };
    });
  });
  app.post('/api/admin/accounts/:id/billing/cancel', limited, async request => {
    const admin = await requireAdmin(request);
    const { id } = idParam.parse(request.params);
    const { immediately } = z.object({ immediately: z.boolean().default(false) }).strict().parse(request.body ?? {});
    const row = await workspace(id);
    if (!row.stripe_subscription_id) throw httpError(409, 'This account has no active subscription');
    const subscriptionId = row.stripe_subscription_id;
    await stripeCall(stripe => immediately ? stripe.subscriptions.cancel(subscriptionId) : stripe.subscriptions.update(subscriptionId, { cancel_at_period_end: true }));
    await audit(admin.email, 'billing.cancel', id, { subscriptionId, immediately });
    return { ok: true };
  });
  app.post('/api/admin/accounts/:id/billing/refund', limited, async request => {
    const admin = await requireAdmin(request);
    const { id } = idParam.parse(request.params);
    const input = z.object({ paymentIntent: z.string().regex(/^pi_\w+$/), amount: z.number().int().positive().optional() }).strict().parse(request.body);
    const row = await workspace(id);
    if (!row.stripe_customer_id) throw httpError(409, 'This account has no billing account');
    const customer = row.stripe_customer_id;
    const refund = await stripeCall(async stripe => {
      const intent = await stripe.paymentIntents.retrieve(input.paymentIntent);
      const owner = typeof intent.customer === 'string' ? intent.customer : intent.customer?.id;
      if (owner !== customer) throw httpError(403, 'That payment does not belong to this account');
      return stripe.refunds.create({ payment_intent: input.paymentIntent, ...(input.amount ? { amount: input.amount } : {}) }, { idempotencyKey: `xaylo-refund-${id}-${input.paymentIntent}-${input.amount ?? 'full'}` });
    });
    await audit(admin.email, 'billing.refund', id, { paymentIntent: input.paymentIntent, amount: input.amount ?? null, refundId: refund.id });
    return { ok: true, refundId: refund.id, status: refund.status };
  });
  app.post('/api/admin/accounts/:id/billing/extend-trial', limited, async request => {
    const admin = await requireAdmin(request);
    const { id } = idParam.parse(request.params);
    const { days } = z.object({ days: z.number().int().min(1).max(90) }).strict().parse(request.body);
    const trialDays = getEnv().FREE_TRIAL_DAYS;
    if (!trialDays) throw httpError(409, 'Time-limited trials are disabled');
    const row = await workspace(id);
    const expiry = Math.max(new Date(row.trial_started_at).getTime() + trialDays * 86400000, Date.now()) + days * 86400000;
    const startedAt = new Date(expiry - trialDays * 86400000);
    await pool.query('UPDATE installations SET trial_started_at=$2 WHERE location_id=$1', [id, startedAt]);
    await audit(admin.email, 'billing.extend_trial', id, { days, trialExpiresAt: new Date(expiry).toISOString() });
    return { ok: true, trialExpiresAt: new Date(expiry).toISOString() };
  });
  app.get('/api/admin/payments', limited, async request => {
    await requireAdmin(request);
    const { after } = z.object({ after: z.string().regex(/^in_\w+$/).optional() }).strict().parse(request.query);
    return stripeCall(async stripe => {
      const invoices = await stripe.invoices.list({ limit: PAGE, ...(after ? { starting_after: after } : {}) });
      const customers = invoices.data.map(i => typeof i.customer === 'string' ? i.customer : i.customer?.id).filter((v): v is string => Boolean(v));
      const owners = new Map((await pool.query('SELECT location_id,stripe_customer_id FROM installations WHERE stripe_customer_id=ANY($1)', [customers])).rows.map(r => [r.stripe_customer_id as string, r.location_id as string]));
      return { hasMore: invoices.has_more, invoices: invoices.data.map(i => {
        const customer = typeof i.customer === 'string' ? i.customer : i.customer?.id;
        return { id: i.id, number: i.number, status: i.status, amountPaid: i.amount_paid, amountDue: i.amount_due, currency: i.currency, created: i.created * 1000,
          email: i.customer_email, accountId: customer ? owners.get(customer) ?? null : null, url: i.hosted_invoice_url };
      }) };
    });
  });

  app.get('/api/admin/settings', limited, async request => {
    await requireAdmin(request);
    const ai = await aiConfig();
    const env = getEnv();
    return { ai: { keyMasked: maskSecret(ai.apiKey), keySource: ai.keySource, model: ai.model, modelSource: ai.modelSource },
      billing: { stripeConfigured: Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID && env.STRIPE_WEBHOOK_SECRET), freeTrialDays: env.FREE_TRIAL_DAYS, paidReportsPerMonth: env.PAID_REPORTS_PER_MONTH },
      admins: env.ADMIN_EMAILS.split(',').map(value => value.trim()).filter(Boolean) };
  });
  // Empty string clears the stored override so the environment value applies again.
  app.put('/api/admin/settings', limited, async request => {
    const admin = await requireAdmin(request);
    const input = z.object({ aiApiKey: z.string().trim().max(500).optional(), aiModel: z.string().trim().max(200).optional() }).strict().parse(request.body);
    if (input.aiApiKey !== undefined) await setSetting('ai_api_key', input.aiApiKey, admin.email);
    if (input.aiModel !== undefined) await setSetting('ai_model', input.aiModel, admin.email);
    await audit(admin.email, 'settings.update', null, { aiApiKey: input.aiApiKey === undefined ? 'unchanged' : input.aiApiKey ? 'set' : 'cleared', aiModel: input.aiModel === undefined ? 'unchanged' : input.aiModel || 'cleared' });
    return { ok: true };
  });
  app.get('/api/admin/audit', limited, async request => {
    await requireAdmin(request);
    return { entries: (await pool.query('SELECT admin_email,action,target,detail,created_at FROM admin_audit ORDER BY created_at DESC LIMIT 100')).rows };
  });
}
