import type { FastifyInstance } from 'fastify';
import type Stripe from 'stripe';
import { pool } from '../db/pool.js';
import { getEnv } from '../config/env.js';
import { httpError, requireSession } from '../security/access.js';
import { stripeClient, subscriptionPaid } from './stripe.js';
import { entitlement } from './entitlements.js';

export async function registerBillingRoutes(app: FastifyInstance) {
  app.get('/api/billing', async request => entitlement((await requireSession(request)).locationId));
  app.post('/api/billing/checkout', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async request => {
    const { locationId } = await requireSession(request);
    const env = getEnv();
    if (!env.STRIPE_PRICE_ID || !env.STRIPE_WEBHOOK_SECRET) throw httpError(503, 'Subscriptions are not configured');
    const stripe = stripeClient();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query('SELECT stripe_customer_id,stripe_subscription_id FROM installations WHERE location_id=$1 FOR UPDATE', [locationId])).rows[0];
      if (row.stripe_subscription_id && row.stripe_customer_id && subscriptionPaid(await stripe.subscriptions.retrieve(row.stripe_subscription_id), row.stripe_customer_id, env.STRIPE_PRICE_ID)) throw httpError(409, 'You already have a subscription. Use Manage subscription.');
      let customerId = row.stripe_customer_id as string | null;
      if (!customerId) {
        const customer = await stripe.customers.create({ metadata: { xayloWorkspace: locationId } }, { idempotencyKey: `xaylo-customer-${locationId}` });
        customerId = customer.id;
        await client.query('UPDATE installations SET stripe_customer_id=$2 WHERE location_id=$1', [locationId, customerId]);
      }
      const current = await stripe.subscriptions.list({ customer: customerId, status: 'active', limit: 100 });
      if (current.has_more || current.data.some(subscription => subscriptionPaid(subscription, customerId!, env.STRIPE_PRICE_ID))) throw httpError(409, 'You already have a subscription. Use Manage subscription, or refresh while its payment is confirmed.');
      // Reuse an open checkout to avoid duplicate subscriptions from double-clicks.
      const open = await stripe.checkout.sessions.list({ customer: customerId, status: 'open', limit: 10 });
      const existing = open.data.find(session => session.mode === 'subscription' && session.metadata?.xayloWorkspace === locationId);
      const checkout = existing || await stripe.checkout.sessions.create({ mode: 'subscription', customer: customerId,
        line_items: [{ price: env.STRIPE_PRICE_ID, quantity: 1 }], client_reference_id: locationId, metadata: { xayloWorkspace: locationId },
        subscription_data: { metadata: { xayloWorkspace: locationId } }, success_url: `${env.PUBLIC_BASE_URL}/app?billing=success`, cancel_url: `${env.PUBLIC_BASE_URL}/app?billing=cancelled` });
      await client.query('COMMIT');
      return { url: checkout.url };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof Error && 'statusCode' in error) throw error;
      throw httpError(502, 'Subscription checkout is unavailable; try again');
    } finally { client.release(); }
  });
  app.post('/api/billing/portal', async request => {
    const { locationId } = await requireSession(request);
    const row = (await pool.query('SELECT stripe_customer_id FROM installations WHERE location_id=$1', [locationId])).rows[0];
    if (!row?.stripe_customer_id) throw httpError(409, 'No billing account is connected');
    try { return { url: (await stripeClient().billingPortal.sessions.create({ customer: row.stripe_customer_id, return_url: `${getEnv().PUBLIC_BASE_URL}/app` })).url }; }
    catch { throw httpError(502, 'The subscription portal is unavailable; try again'); }
  });
  app.post('/webhooks/stripe', { bodyLimit: 1024 * 1024 }, async (request, reply) => {
    const env = getEnv();
    if (!env.STRIPE_SECRET_KEY || !env.STRIPE_WEBHOOK_SECRET) throw httpError(503, 'Billing webhooks are not configured');
    const stripe = stripeClient();
    let event: Stripe.Event;
    try { event = stripe.webhooks.constructEvent(request.body as Buffer, request.headers['stripe-signature'] as string, env.STRIPE_WEBHOOK_SECRET); }
    catch { return reply.code(400).send({ error: 'Invalid billing signature' }); }
    if (!['checkout.session.completed', 'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted', 'invoice.paid', 'invoice.payment_failed'].includes(event.type)) return { ok: true };
    const object = event.data.object as { customer?: string | { id: string } | null };
    const customerId = typeof object.customer === 'string' ? object.customer : object.customer?.id;
    if (!customerId) return { ok: true };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query('SELECT location_id FROM installations WHERE stripe_customer_id=$1 FOR UPDATE', [customerId])).rows[0];
      if (!row) { await client.query('COMMIT'); return { ok: true }; }
      const receipt = await client.query('INSERT INTO billing_receipts(event_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING event_id', [event.id]);
      if (!receipt.rowCount) { await client.query('COMMIT'); return { ok: true, duplicate: true }; }
      // Read current Stripe state under the workspace lock; event delivery order cannot restore an old subscription.
      const subscriptions = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 });
      if (subscriptions.has_more) throw httpError(503, 'Billing reconciliation requires additional subscription pages');
      const active = subscriptions.data.find(subscription => subscriptionPaid(subscription, customerId, env.STRIPE_PRICE_ID));
      await client.query('UPDATE installations SET stripe_subscription_id=$2 WHERE location_id=$1', [row.location_id, active?.id || null]);
      await client.query('COMMIT');
      return { ok: true };
    } catch {
      await client.query('ROLLBACK');
      throw httpError(503, 'Billing reconciliation failed; retry delivery');
    } finally { client.release(); }
  });
}
