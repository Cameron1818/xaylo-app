import { randomUUID } from 'node:crypto';
import { pool } from '../db/pool.js';
import { getEnv } from '../config/env.js';
import { httpError } from '../security/access.js';
import { stripeClient, subscriptionPaid } from './stripe.js';

export async function entitlement(locationId: string) {
  const env = getEnv();
  const row = (await pool.query("SELECT trial_started_at,stripe_customer_id,stripe_subscription_id FROM installations WHERE location_id=$1 AND status='active'", [locationId])).rows[0];
  if (!row) throw httpError(403, 'Workspace is not active');
  let paid = false;
  // Stripe remains the billing system of record. Only its object references are stored locally.
  if (row.stripe_subscription_id && row.stripe_customer_id) {
    if (!env.STRIPE_SECRET_KEY || !env.STRIPE_PRICE_ID) throw httpError(503, 'Subscription status cannot be verified');
    try { paid = subscriptionPaid(await stripeClient().subscriptions.retrieve(row.stripe_subscription_id), row.stripe_customer_id, env.STRIPE_PRICE_ID); }
    catch { throw httpError(503, 'Subscription status could not be verified; try again'); }
  }
  const trialExpiresAt = env.FREE_TRIAL_DAYS ? new Date(new Date(row.trial_started_at).getTime() + env.FREE_TRIAL_DAYS * 86400000).toISOString() : null;
  const trialActive = !trialExpiresAt || new Date(trialExpiresAt).getTime() > Date.now();
  const windowKey = paid ? `paid:${new Date().toISOString().slice(0, 7)}` : 'free';
  const used = Number((await pool.query("SELECT count(*) AS count FROM report_usage WHERE location_id=$1 AND window_key=$2 AND (status='completed' OR expires_at>now())", [locationId, windowKey])).rows[0].count);
  const limit = paid ? env.PAID_REPORTS_PER_MONTH : 1;
  return { tier: paid ? 'paid' as const : 'free' as const, paid, trialExpiresAt, trialActive, windowKey, used, limit,
    reportsRemaining: Math.max(0, limit - used), maxLookbackDays: paid ? 90 : env.FREE_REPORT_LOOKBACK_DAYS,
    canAnalyse: paid || trialActive, canGenerate: (paid || trialActive) && used < limit,
    checkoutConfigured: Boolean(env.STRIPE_SECRET_KEY && env.STRIPE_PRICE_ID && env.STRIPE_WEBHOOK_SECRET),
    hasBillingAccount: Boolean(row.stripe_customer_id), paidReportsPerMonth: env.PAID_REPORTS_PER_MONTH };
}
export async function requireAnalysisAccess(locationId: string, days: number) {
  const access = await entitlement(locationId);
  if (!access.canAnalyse) throw httpError(402, 'Your free trial has ended. Subscribe to run new analysis.');
  if (days > access.maxLookbackDays) throw httpError(402, `Your current tier includes up to ${access.maxLookbackDays} days of analysis. Subscribe for longer reporting periods.`);
  return access;
}
export async function reserveReport(locationId: string, days: number) {
  const access = await requireAnalysisAccess(locationId, days);
  const client = await pool.connect();
  const id = randomUUID();
  try {
    await client.query('BEGIN');
    const active = await client.query("SELECT 1 FROM installations WHERE location_id=$1 AND status='active' FOR UPDATE", [locationId]);
    if (!active.rowCount) throw httpError(403, 'Workspace is not active');
    const count = Number((await client.query("SELECT count(*) AS count FROM report_usage WHERE location_id=$1 AND window_key=$2 AND (status='completed' OR expires_at>now())", [locationId, access.windowKey])).rows[0].count);
    if (count >= access.limit) throw httpError(402, access.paid ? 'Your monthly report allowance has been used.' : 'Your free report has been used. Subscribe to generate more reports.');
    await client.query("INSERT INTO report_usage(id,location_id,window_key,status,expires_at) VALUES($1,$2,$3,'pending',now()+interval '30 minutes')", [id, locationId, access.windowKey]);
    await client.query('COMMIT');
    return id;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
export async function releaseReport(locationId: string, id: string) {
  await pool.query("DELETE FROM report_usage WHERE location_id=$1 AND id=$2 AND status='pending'", [locationId, id]);
}
