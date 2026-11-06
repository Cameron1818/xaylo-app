import assert from 'node:assert/strict';
import test from 'node:test';

test('app serves dashboard assets and guards management API', async () => {
  Object.assign(process.env, {
    PUBLIC_BASE_URL: 'https://app.example.com', DATABASE_URL: 'postgres://unused:unused@localhost:5432/unused',
    GHL_CLIENT_ID: 'client', GHL_CLIENT_SECRET: 'secret', GHL_SHARED_SECRET: 'shared', GHL_APP_ID: 'app',
    ENCRYPTION_KEY: 'ab'.repeat(32), SESSION_SECRET: 'secret'.repeat(8)
  });
  const { buildApp } = await import('../src/http/app.js');
  const app = await buildApp();
  try {
    assert.equal((await app.inject('/health')).statusCode, 200);
    for (const route of ['/', '/guide']) {
      const guide = await app.inject(route);
      assert.equal(guide.statusCode, 200);
      assert.match(guide.headers['content-type'] ?? '', /text\/html/);
      assert.match(guide.body, /Give every visit/);
      assert.match(guide.body, /id="setup"/);
      assert.match(guide.body, /href="\/app"/);
      assert.doesNotMatch(guide.body, /__TRIAL_LABEL__|__FREE_LOOKBACK__|__TRIAL_DETAIL__/);
    }
    const page = await app.inject('/app');
    assert.equal(page.statusCode, 200);
    const bundle = page.body.match(/src="(\/assets\/[^\"]+\.js)"/)?.[1];
    assert.ok(bundle);
    assert.equal((await app.inject(bundle)).statusCode, 200);
    assert.equal((await app.inject('/assets/tracker.js')).statusCode, 200);
    const logo = await app.inject('/assets/xaylo-logo.png');
    assert.equal(logo.statusCode, 200);
    assert.match(logo.headers['content-type'] ?? '', /image\/png/);
    assert.equal((await app.inject('/assets/secrets.env')).statusCode, 404);
    assert.equal((await app.inject('/api/journeys')).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: '/webhooks/ghl', payload: {}, headers: { 'content-type': 'application/json' } })).statusCode, 401);
  } finally { await app.close(); }
});
