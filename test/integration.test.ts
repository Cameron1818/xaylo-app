import './helpers/env.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { pool } from '../src/db/pool.js';
import { buildApp } from '../src/http/app.js';
import { encrypt, signToken } from '../src/security/crypto.js';
import { getEnv } from '../src/config/env.js';
import { expireTransientData } from '../src/db/retention.js';
import { reserveReport, releaseReport } from '../src/billing/entitlements.js';
import { stripeClient } from '../src/billing/stripe.js';

const enabled = Boolean(process.env.TEST_DATABASE_URL);
test('database integration: clients, accounts, reports, MCP, quotas and billing', { skip: !enabled }, async t => {
  for (const file of ['001_init.sql', '002_sessions.sql', '003_reporting.sql', '004_accounts.sql', '005_entitlements.sql']) await pool.query(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  // Migration scripts must be safe to rerun.
  for (const file of ['003_reporting.sql', '004_accounts.sql', '005_entitlements.sql']) await pool.query(await readFile(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  const app = await buildApp();
  const previousFetch = globalThis.fetch;
  const fixtures: string[] = [];
  const emails: string[] = [];
  let aiCalls = 0, sourceCalls = 0, aiInvalid = false, emailBody: any;
  let stripeActive = true, googleNextPage = false;
  const stripeSubscription = () => ({ id: 'sub_test', object: 'subscription', customer: 'cus_test', status: stripeActive ? 'active' : 'canceled',
    items: { object: 'list', data: [{ id: 'si_test', current_period_end: Math.floor(Date.now() / 1000) + 86400, price: { id: 'price_test' } }], has_more: false } });
  const fixture = async () => {
    const locationId = randomUUID(), externalId = `ghl-${locationId}`, siteKey = randomBytes(24).toString('hex'); fixtures.push(locationId);
    await pool.query(`INSERT INTO installations(location_id,ghl_location_id,access_token,refresh_token,expires_at,site_key,allowed_origins) VALUES($1,$2,$3,$4,now()+interval '1 day',$5,ARRAY['https://client.example'])`,
      [locationId, externalId, encrypt(`ghl:${externalId}`, getEnv().ENCRYPTION_KEY), encrypt('refresh', getEnv().ENCRYPTION_KEY), siteKey]);
    return { locationId, externalId, siteKey, headers: { authorization: `Bearer ${signToken({ kind: 'session', locationId, ghlLocationId: externalId, userId: 'admin' }, getEnv().SESSION_SECRET, 3600)}` } };
  };
  const a = await fixture(), b = await fixture();
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = async (url, init) => {
    const target = String(url);
    if (target.startsWith('https://api.resend.com/')) { emailBody = JSON.parse(String(init?.body)); return json({ id: 'email_test' }); }
    if (target === 'https://api.openai.com/v1/responses') {
      aiCalls++; const sent = JSON.parse(String(init?.body)); assert.equal(sent.store, false);
      assert.doesNotMatch(sent.input, /private-email|private-name|secret-phone/);
      return json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({
        trafficAnalysis: { summary: 'Review the observed conversion path.', findings: [{ observation: 'Some website sessions converted.', evidenceIds: [aiInvalid ? 'invalid' : 'traffic.totals'], confidence: 'low' }] },
        marketingRecommendations: [{ action: 'Test the landing page message.', rationale: 'Use the observed traffic as a baseline.', priority: 'medium', confidence: 'low', evidenceIds: ['traffic.totals'] }], dataQuality: []
      }) }] }] });
    }
    if (target.startsWith('https://api.stripe.com/')) {
      if (target.includes('/subscriptions/sub_test')) return json(stripeSubscription());
      if (target.includes('/subscriptions?')) return json({ object: 'list', data: stripeActive ? [stripeSubscription()] : [], has_more: false });
      throw Error(`Unexpected Stripe path: ${new URL(target).pathname}`);
    }
    if (target.startsWith('https://services.leadconnectorhq.com/')) {
      sourceCalls++;
      const headers = new Headers(init?.headers), externalId = headers.get('authorization')?.replace('Bearer ghl:', '') || '';
      const path = new URL(target);
      if (path.pathname === '/contacts/search') {
        const body = JSON.parse(String(init?.body)); assert.equal(body.locationId, externalId); assert.ok(body.filters[0].value.gte);
        return json({ contacts: [{ id: 'contact-1', locationId: externalId, firstName: 'private-name', email: 'private-email', phone: 'secret-phone', tags: ['interested'], source: 'Website' }] });
      }
      if (path.pathname === '/opportunities/pipelines') { assert.equal(path.searchParams.get('locationId'), externalId); return json({ pipelines: [{ id: 'pipeline-1', name: 'Sales' }] }); }
      if (path.pathname === '/opportunities/search') { assert.equal(path.searchParams.get('locationId'), externalId); return json({ opportunities: [{ id: 'opp-1', locationId: externalId, status: 'won', monetaryValue: 100, pipelineId: 'pipeline-1' }] }); }
      if (path.pathname === `/locations/${externalId}`) return json({ location: { id: externalId, name: externalId === a.externalId ? 'Business A' : 'Business B', timezone: 'Europe/London', website: 'https://client.example' } });
      throw Error('Unexpected GHL request');
    }
    if (target.startsWith('https://googleads.googleapis.com/')) {
      sourceCalls++; const request = JSON.parse(String(init?.body));
      assert.ok(request.query.includes('SELECT'));
      return json({ ...(googleNextPage ? { nextPageToken: 'next' } : {}), results: [{ campaign: { id: '123', name: 'Spring' }, metrics: { impressions: '100', clicks: '10', costMicros: '10000000', conversions: '2', conversionsValue: '50' } }] });
    }
    throw Error(`Unexpected source: ${target}`);
  };
  const inject = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, headers: Record<string, string>, payload?: any) => app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload }) });
  try {
    await t.test('website sign-up verifies email, creates one workspace, and revokes sessions on logout', async () => {
      const email = `${randomUUID()}@example.com`; emails.push(email);
      const sent = await inject('POST', '/api/auth/email', {}, { email }); assert.equal(sent.statusCode, 200);
      assert.equal(emailBody.to[0], email);
      const token = emailBody.text.match(/#signin=([A-Za-z0-9_-]+)/)[1];
      const signed = await inject('POST', '/api/auth/redeem', {}, { token }); assert.equal(signed.statusCode, 200);
      const access = signed.json().token, cookie = String(signed.headers['set-cookie']).split(';')[0];
      assert.equal((await inject('POST', '/api/auth/redeem', {}, { token })).statusCode, 400);
      const settings = await inject('GET', '/api/settings', { authorization: `Bearer ${access}` }); assert.equal(settings.statusCode, 200);
      const workspaceId = settings.json().locationId; fixtures.push(workspaceId);
      assert.equal((await pool.query('SELECT ghl_location_id FROM installations WHERE location_id=$1', [workspaceId])).rows[0].ghl_location_id, null);
      assert.equal((await inject('POST', '/api/auth/session', { cookie })).statusCode, 200);
      assert.equal((await inject('POST', '/api/auth/logout', { authorization: `Bearer ${access}` })).statusCode, 200);
      assert.equal((await inject('GET', '/api/settings', { authorization: `Bearer ${access}` })).statusCode, 401);
      assert.equal((await inject('POST', '/api/auth/session', { cookie })).statusCode, 401);
    });
    await t.test('management context and account references cannot cross client boundaries', async () => {
      await inject('PUT', '/api/reporting/context', a.headers, { goals: 'A-only goal' });
      assert.equal((await inject('GET', '/api/reporting/context', b.headers)).json().goals, '');
      await pool.query(`INSERT INTO google_connections(location_id,access_token,refresh_token,expires_at) VALUES($1,$2,$3,now()+interval '1 day')`, [b.locationId, encrypt('google-b', getEnv().ENCRYPTION_KEY), encrypt('refresh', getEnv().ENCRYPTION_KEY)]);
      await pool.query(`INSERT INTO google_accounts(location_id,customer_id,name,currency,time_zone) VALUES($1,'1234567890','B Ads','GBP','Europe/London')`, [b.locationId]);
      const before = sourceCalls;
      assert.equal((await inject('GET', '/api/analysis?days=7&customerId=1234567890', a.headers)).statusCode, 404);
      assert.equal(sourceCalls, before);
      assert.equal((await inject('GET', '/api/analysis?days=7&locationId=other', a.headers)).statusCode, 400);
    });
    await t.test('selected Ads accounts return currency-labelled metrics and capped results are explicit', async () => {
      const report = await inject('GET', '/api/analysis?days=7&customerId=1234567890', b.headers);
      assert.equal(report.statusCode, 200); assert.equal(report.json().ads.data.account.currency, 'GBP');
      assert.equal(report.json().ads.data.totals.spend, 10); assert.equal(report.json().ads.data.totals.cpa, 5);
      googleNextPage = true; process.env.REPORT_SOURCE_MAX_PAGES = '1';
      try {
        const partial = await inject('GET', '/api/analysis?days=7&customerId=1234567890', b.headers);
        assert.equal(partial.statusCode, 200); assert.equal(partial.json().ads.data.truncated, true);
        assert.ok(partial.json().ads.data.limitations.some((value: string) => value.includes('partial')));
      } finally { googleNextPage = false; process.env.REPORT_SOURCE_MAX_PAGES = '20'; }
    });
    await t.test('collection deduplicates conversions and removes query strings from attribution', async () => {
      const payload = { siteKey: a.siteKey, visitorId: randomUUID(), sessionId: randomUUID(), pageUrl: 'https://client.example/book?email=private', eventType: 'conversion', utmSource: 'google', utmMedium: 'cpc', campaignId: '123', attribution: { firstTouch: { landingPage: 'https://client.example/?email=private' } } };
      const headers = { origin: 'https://client.example' };
      const responses = await Promise.all([inject('POST', '/collect', headers, payload), inject('POST', '/collect', headers, payload)]);
      assert.ok(responses.every(response => response.statusCode === 200));
      const rows = (await pool.query('SELECT page_url,properties FROM events WHERE location_id=$1', [a.locationId])).rows;
      assert.equal(rows.length, 1); assert.doesNotMatch(JSON.stringify(rows), /email=|private/);
      const overview = await inject('GET', '/api/analysis?days=7', a.headers); assert.equal(overview.statusCode, 200);
      assert.equal(overview.json().traffic.conversions, 1); assert.equal(overview.json().crm.data.contacts.count, 1);
      assert.doesNotMatch(overview.body, /private-name|private-email|secret-phone|contact-1/);
    });
    await t.test('CRM lookup outages do not discard a signed visitor’s tracking event', async () => {
      const contactToken = signToken({ kind: 'contact', locationId: a.locationId, contactId: 'missing-contact' }, getEnv().SESSION_SECRET, 60);
      const response = await inject('POST', '/collect', { origin: 'https://client.example' }, { siteKey: a.siteKey, visitorId: randomUUID(), sessionId: randomUUID(), pageUrl: 'https://client.example/', eventType: 'page_view', contactToken });
      assert.equal(response.statusCode, 200); assert.equal(response.json().tagSync, 'unavailable');
      const rows = await pool.query("SELECT properties FROM events WHERE location_id=$1 AND properties->>'tagSync'='unavailable'", [a.locationId]);
      assert.equal(rows.rowCount, 1);
    });
    await t.test('concurrent free report reservations allow exactly one and failures release the allowance', async () => {
      const reservations = await Promise.allSettled([reserveReport(a.locationId, 7), reserveReport(a.locationId, 7)]);
      assert.equal(reservations.filter(value => value.status === 'fulfilled').length, 1);
      for (const result of reservations) if (result.status === 'fulfilled') await releaseReport(a.locationId, result.value);
      aiInvalid = true;
      assert.equal((await inject('POST', '/api/reports', a.headers, { days: 7 })).statusCode, 502);
      assert.equal((await inject('GET', '/api/billing', a.headers)).json().reportsRemaining, 1);
      aiInvalid = false;
    });
    let reportId: string;
    await t.test('saved reports contain summaries, enforce ownership, and cannot reset free usage by deletion', async () => {
      const report = await inject('POST', '/api/reports', a.headers, { days: 7 }); assert.equal(report.statusCode, 200);
      reportId = report.json().id;
      assert.ok(report.json().evidence.metrics['traffic.totals']); assert.match(report.json().prompt_version, /^2026-/);
      assert.doesNotMatch(report.body, /private-email|private-name|secret-phone|contact-1/);
      assert.equal((await inject('GET', `/api/reports/${reportId}`, b.headers)).statusCode, 404);
      assert.equal((await inject('DELETE', `/api/reports/${reportId}`, b.headers)).statusCode, 404);
      const before = aiCalls;
      assert.equal((await inject('POST', '/api/reports', a.headers, { days: 7 })).statusCode, 402); assert.equal(aiCalls, before);
    });
    let mcpToken: string, refreshToken: string, clientId: string;
    await t.test('MCP OAuth requires explicit consent, exact redirect/resource and one-use S256 grants', async () => {
      assert.equal((await inject('POST', '/oauth/mcp/register', {}, { redirect_uris: ['javascript:alert(1)'] })).statusCode, 400);
      const registration = await inject('POST', '/oauth/mcp/register', {}, { client_name: 'Test assistant', redirect_uris: ['http://127.0.0.1:54321/callback'] }); assert.equal(registration.statusCode, 201);
      clientId = registration.json().client_id;
      const verifier = 'v'.repeat(43), challenge = createHash('sha256').update(verifier).digest('base64url');
      const params = new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: 'http://127.0.0.1:54321/callback', state: 'expected-state', code_challenge: challenge, code_challenge_method: 'S256', resource: 'https://app.example.com/mcp', scope: 'reports:read reports:generate' });
      const authorize = await inject('GET', `/oauth/mcp/authorize?${params}`, {}); assert.equal(authorize.statusCode, 200);
      const cookie = String(authorize.headers['set-cookie']).split(';')[0];
      const userCode = authorize.body.match(/<code>([A-F0-9]{12})<\/code>/)![1];
      assert.equal((await inject('GET', '/oauth/mcp/status', { cookie })).json().pending, true);
      assert.equal((await inject('GET', `/api/mcp/requests/${userCode}`, a.headers)).json().clientName, 'Test assistant');
      assert.equal((await inject('POST', '/api/mcp/approve', a.headers, { code: userCode })).statusCode, 200);
      const redirect = new URL((await inject('GET', '/oauth/mcp/status', { cookie })).json().redirect); assert.equal(redirect.searchParams.get('state'), 'expected-state');
      const exchange = { grant_type: 'authorization_code', client_id: clientId, code: redirect.searchParams.get('code'), redirect_uri: 'http://127.0.0.1:54321/callback', code_verifier: verifier, resource: 'https://app.example.com/mcp' };
      assert.equal((await inject('POST', '/oauth/mcp/token', {}, { ...exchange, code_verifier: 'x'.repeat(43) })).statusCode, 400);
      const tokens = await inject('POST', '/oauth/mcp/token', {}, exchange); assert.equal(tokens.statusCode, 200); mcpToken = tokens.json().access_token; refreshToken = tokens.json().refresh_token;
      assert.equal((await inject('POST', '/oauth/mcp/token', {}, exchange)).statusCode, 400);
    });
    const mcp = (token: string, name: string, args: object = {}) => inject('POST', '/mcp', { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' }, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    await t.test('MCP uses the same client ownership, trial and report allowance as the dashboard', async () => {
      const allowance = await mcp(mcpToken, 'get_reporting_allowance'); assert.equal(allowance.statusCode, 200);
      assert.equal(JSON.parse(allowance.json().result.content[0].text).reportsRemaining, 0);
      const foreign = await mcp(mcpToken, 'get_google_ads_performance', { days: 7, customerId: '1234567890' }); assert.equal(foreign.json().result.isError, true);
      const before = aiCalls;
      const quota = await mcp(mcpToken, 'generate_marketing_report', { days: 7 }); assert.equal(quota.json().result.isError, true); assert.equal(aiCalls, before);
      const deleted = await inject('DELETE', `/api/reports/${reportId!}`, a.headers); assert.equal(deleted.statusCode, 200);
      assert.equal((await inject('GET', '/api/billing', a.headers)).json().reportsRemaining, 0);
    });
    await t.test('MCP refresh rotates both tokens and revocation takes immediate effect', async () => {
      const exchange = { grant_type: 'refresh_token', client_id: clientId!, resource: 'https://app.example.com/mcp', refresh_token: refreshToken! };
      const refreshed = await inject('POST', '/oauth/mcp/token', {}, exchange); assert.equal(refreshed.statusCode, 200);
      assert.equal((await mcp(mcpToken, 'list_reports')).statusCode, 401);
      assert.equal((await inject('POST', '/oauth/mcp/token', {}, exchange)).statusCode, 400);
      assert.equal((await mcp(refreshed.json().access_token, 'list_reports')).statusCode, 200);
      await inject('POST', '/oauth/mcp/revoke', {}, { client_id: clientId, token: refreshed.json().refresh_token });
      assert.equal((await mcp(refreshed.json().access_token, 'list_reports')).statusCode, 401);
    });
    await t.test('expired trials block new analysis but not saved report access or basic settings', async () => {
      await pool.query("UPDATE installations SET trial_started_at=now()-interval '8 days' WHERE location_id=$1", [a.locationId]);
      assert.equal((await inject('GET', '/api/analysis?days=7', a.headers)).statusCode, 402);
      assert.equal((await inject('GET', '/api/reports', a.headers)).statusCode, 200);
      assert.equal((await inject('GET', '/api/settings', a.headers)).statusCode, 200);
      assert.equal((await inject('GET', '/api/analysis?days=30', b.headers)).statusCode, 402);
    });
    await t.test('paid access is verified with Stripe and unsigned or duplicate webhooks cannot grant access', async () => {
      await pool.query("UPDATE installations SET stripe_customer_id='cus_test',stripe_subscription_id='sub_test' WHERE location_id=$1", [a.locationId]);
      assert.equal((await inject('GET', '/api/billing', a.headers)).json().paid, true);
      assert.equal((await inject('GET', '/api/analysis?days=90', a.headers)).statusCode, 200);
      const payload = JSON.stringify({ id: 'evt_test', object: 'event', type: 'customer.subscription.updated', data: { object: { customer: 'cus_test' } } });
      assert.equal((await inject('POST', '/webhooks/stripe', { 'content-type': 'application/json', 'stripe-signature': 'invalid' }, payload)).statusCode, 400);
      const signature = stripeClient().webhooks.generateTestHeaderString({ payload, secret: getEnv().STRIPE_WEBHOOK_SECRET });
      const headers = { 'content-type': 'application/json', 'stripe-signature': signature };
      assert.equal((await inject('POST', '/webhooks/stripe', headers, payload)).statusCode, 200);
      assert.equal((await inject('POST', '/webhooks/stripe', headers, payload)).json().duplicate, true);
      stripeActive = false;
      assert.equal((await inject('GET', '/api/billing', a.headers)).json().paid, false);
    });
    await t.test('retention deletes old journey events and expired credentials, while inactive workspaces reject sessions', async () => {
      await pool.query(`INSERT INTO events(id,location_id,visitor_id,event_type,created_at) VALUES($1,$2,'old','page_view',now()-interval '91 days')`, [randomUUID(), a.locationId]);
      await expireTransientData();
      assert.equal((await pool.query("SELECT 1 FROM events WHERE location_id=$1 AND visitor_id='old'", [a.locationId])).rowCount, 0);
      await pool.query("UPDATE installations SET status='uninstalled' WHERE location_id=$1", [a.locationId]);
      assert.equal((await inject('GET', '/api/settings', a.headers)).statusCode, 403);
    });
  } finally {
    globalThis.fetch = previousFetch;
    await pool.query('DELETE FROM installations WHERE location_id=ANY($1::text[])', [fixtures]);
    await pool.query('DELETE FROM app_users WHERE email=ANY($1::text[])', [emails]);
    await pool.query("DELETE FROM mcp_clients WHERE name='Test assistant'");
    await pool.query("DELETE FROM billing_receipts WHERE event_id='evt_test'");
    await app.close(); await pool.end();
  }
});
