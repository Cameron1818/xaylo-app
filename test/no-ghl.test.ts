import './helpers/env.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildApp } from '../src/http/app.js';
import { getEnv, ghlConfigured } from '../src/config/env.js';

test('website-only production startup needs no GHL credentials and cannot accept GHL identity with an empty secret', async () => {
  Object.assign(process.env, { GHL_CLIENT_ID: '', GHL_CLIENT_SECRET: '', GHL_SHARED_SECRET: '', GHL_APP_ID: '', NODE_ENV: 'production' });
  assert.equal(ghlConfigured(getEnv()), false);
  const app = await buildApp();
  try {
    assert.equal((await app.inject('/')).statusCode, 200);
    assert.equal((await app.inject('/app')).statusCode, 200);
    assert.equal((await app.inject('/api/dev/session')).statusCode, 404);
    assert.equal((await app.inject({ method: 'POST', url: '/api/session', payload: { encryptedData: 'untrusted' } })).statusCode, 503);
    assert.equal((await app.inject('/oauth/callback?code=untrusted')).statusCode, 503);
    assert.equal((await app.inject({ method: 'POST', url: '/webhooks/ghl', payload: {} })).statusCode, 503);
  } finally { await app.close(); }
});
