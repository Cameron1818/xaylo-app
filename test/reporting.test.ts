import './helpers/env.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { adsMetrics } from '../src/google/reporting.js';
import { summarizeTraffic } from '../src/reporting/traffic.js';
import { adsDates, reportPeriod } from '../src/reporting/period.js';
import { eventProperties } from '../src/traffic/attribution.js';
import { journeyInput, matchesJourney } from '../src/journeys/model.js';
import { validRedirect, verifyPkce } from '../src/mcp/oauth.js';
import { createHash } from 'node:crypto';
import { generateAnalysis } from '../src/reporting/ai.js';
import { sourceJson } from '../src/integrations/http.js';

test('Ads currency micros and zero denominators are calculated in code', () => {
  const metrics = adsMetrics({ costMicros: '12345678', impressions: '100', clicks: '10', conversions: '2.5', conversionsValue: '50' });
  assert.equal(metrics.spend, 12.345678); assert.equal(metrics.ctr, .1); assert.equal(metrics.cpa, 12.345678 / 2.5);
  assert.equal(adsMetrics().roas, null); assert.equal(adsMetrics().ctr, null); assert.equal(adsMetrics().cpa, null);
});
test('Ads dates use the account time zone and include the partial current day', () => {
  const period = reportPeriod(7, new Date('2026-11-06T00:30:00Z'));
  assert.deepEqual(adsDates(period, 'America/Los_Angeles'), { start: '2026-10-30', end: '2026-11-05', timeZone: 'America/Los_Angeles', includesPartialToday: true });
});
test('traffic summaries count sessions and conversions once without leaking identifiers', () => {
  const base = { visitor_id: 'secret-visitor', session_id: 'session', page_url: 'https://example.com/offer?email=private', properties: { utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'spring', campaignId: '123' }, contact_id: 'secret-contact' };
  const summary = summarizeTraffic([
    { ...base, id: '1', event_type: 'page_view', created_at: '2026-11-01T00:00:00Z' },
    { ...base, id: '2', event_type: 'conversion', created_at: '2026-11-01T00:01:00Z' },
    { ...base, id: '3', event_type: 'conversion', created_at: '2026-11-01T00:02:00Z' },
    { ...base, id: '4', event_type: 'page_view', created_at: '2026-11-01T01:00:00Z' }
  ]);
  assert.equal(summary.sessions, 2); assert.equal(summary.conversions, 1); assert.equal(summary.contactLinkedConversions, 1);
  assert.equal(summary.channels[0]?.conversionRate, .5);
  assert.doesNotMatch(JSON.stringify(summary), /secret-|email=|private/);
});
test('attribution strips query strings and validates campaign identifiers', () => {
  const result = eventProperties({ utmMedium: 'cpc', campaignId: '123', referrer: 'https://google.com/?email=private',
    attribution: { firstTouch: { utmSource: 'google', landingPage: 'https://example.com/a?secret=x#fragment' } } });
  assert.equal(result.referrer, 'https://google.com/'); assert.equal(result.attribution.firstTouch?.landingPage, 'https://example.com/a');
  assert.throws(() => eventProperties({ campaignId: "1' OR 1=1" }));
});
test('journeys accept legacy rules and match all five UTM fields', () => {
  const input = journeyInput.parse({ name: 'Paid', slug: 'paid', rules: { utmSource: 'google', utmMedium: 'cpc', utmCampaign: 'spring', utmContent: 'video', utmTerm: 'journeys' },
    content: { headline: '', description: '', ctaText: '', ctaUrl: '' } });
  assert.equal(matchesJourney(input.rules, { ...input.rules, utmMedium: 'CPC' }), true);
  assert.equal(matchesJourney(input.rules, { ...input.rules, utmContent: 'banner' }), false);
  assert.equal(journeyInput.parse({ ...input, rules: { utmSource: 'google' } }).rules.utmMedium, '');
});
test('MCP redirects and PKCE reject unsafe grants', () => {
  assert.equal(validRedirect('https://assistant.example/callback'), true); assert.equal(validRedirect('http://127.0.0.1:1234/callback'), true);
  assert.equal(validRedirect('javascript:alert(1)'), false); assert.equal(validRedirect('http://evil.example/callback'), false); assert.equal(validRedirect('https://example.com/#token'), false);
  const verifier = 'v'.repeat(43), challenge = createHash('sha256').update(verifier).digest('base64url');
  assert.equal(verifyPkce(verifier, challenge), true); assert.equal(verifyPkce('a'.repeat(43), challenge), false);
});
test('AI requests disable storage, send only provided summaries and reject unknown evidence', async () => {
  const previous = globalThis.fetch;
  let sent: any;
  globalThis.fetch = async (_url, init) => {
    sent = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
      trafficAnalysis: { summary: 'Observed traffic', findings: [{ observation: 'A finding', evidenceIds: ['made-up-source'], confidence: 'high' }] }, marketingRecommendations: [], dataQuality: []
    }) }] }] }), { status: 200 });
  };
  try {
    await assert.rejects(generateAnalysis({ goals: 'Bookings' }, { 'traffic.totals': { sessions: 10 } }, []), /unsupported evidence/);
    assert.equal(sent.store, false); assert.equal(sent.model, 'test-model'); assert.equal(sent.text.format.strict, true);
    assert.doesNotMatch(JSON.stringify(sent), /test-ai-key/);
  } finally { globalThis.fetch = previous; }
});
test('source requests retry rate limits and discard upstream error payloads', async () => {
  const previous = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => ++calls === 1 ? new Response('private customer detail', { status: 429, headers: { 'retry-after': '0' } }) : new Response('{"ok":true}', { status: 200 });
  try { assert.deepEqual(await sourceJson('Example', 'https://example.test'), { ok: true }); assert.equal(calls, 2); }
  finally { globalThis.fetch = previous; }
  globalThis.fetch = async () => new Response('private customer detail', { status: 403 });
  try { await assert.rejects(sourceJson('Example', 'https://example.test'), error => error instanceof Error && /reconnect/.test(error.message) && !error.message.includes('private')); }
  finally { globalThis.fetch = previous; }
});
