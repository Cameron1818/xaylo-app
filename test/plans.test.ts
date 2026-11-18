import assert from 'node:assert/strict';
import test from 'node:test';
import { PLANS, formatPrice, planCardsHtml } from '../src/billing/plans.js';

test('Insights is the only purchasable plan, priced in GBP', () => {
  const insights = PLANS.find(plan => plan.id === 'insights');
  assert.ok(insights);
  assert.equal(insights.available, true);
  assert.equal(formatPrice(insights, 'monthly'), '£49/month');
  assert.equal(formatPrice(insights, 'yearly'), '£490/year');
  assert.deepEqual(PLANS.filter(plan => plan.available).map(plan => plan.id), ['insights']);
});

test('Autopilot is listed as currently unavailable', () => {
  const autopilot = PLANS.find(plan => plan.id === 'autopilot');
  assert.ok(autopilot);
  assert.equal(autopilot.available, false);
  assert.equal(formatPrice(autopilot, 'monthly'), '£149/month');
  assert.equal(formatPrice(autopilot, 'yearly'), '£1,490/year');
  for (const feature of [/daily/i, /automatic ROI/i, /automated strategy/i, /custom AI journeys/i]) assert.ok(autopilot.features.some(item => feature.test(item)));
});

test('plan cards disable unavailable plans and escape text', () => {
  const html = planCardsHtml([{ ...PLANS[1], name: '<b>Test</b>' }]);
  assert.match(html, /is-unavailable/);
  assert.match(html, /Currently unavailable/);
  assert.match(html, /aria-disabled="true"/);
  assert.doesNotMatch(html, /href="\/app"/);
  assert.doesNotMatch(html, /<b>Test<\/b>/);
});
