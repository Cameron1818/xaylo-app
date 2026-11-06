import Stripe from 'stripe';
import { getEnv } from '../config/env.js';
import { httpError } from '../security/access.js';

export function stripeClient() {
  const env = getEnv();
  if (!env.STRIPE_SECRET_KEY) throw httpError(503, 'Subscriptions are not configured');
  return new Stripe(env.STRIPE_SECRET_KEY, { timeout: 20_000, maxNetworkRetries: 1, httpClient: Stripe.createFetchHttpClient() });
}
export function subscriptionPaid(subscription: Stripe.Subscription, customerId: string, priceId: string, now = Date.now()) {
  const customer = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
  return customer === customerId && subscription.status === 'active' && subscription.items.data.some(item =>
    item.price.id === priceId && item.current_period_end * 1000 > now);
}
