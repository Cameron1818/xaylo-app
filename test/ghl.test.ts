import assert from 'node:assert/strict';
import test from 'node:test';

const base = { access_token: 'a', refresh_token: 'r', expires_in: 3600 };
test('single-location pilot accepts location and one-approved-location agency installs', async () => {
  Object.assign(process.env, { PUBLIC_BASE_URL: 'https://app.example.com', DATABASE_URL: 'postgres://unused:unused@localhost:5432/unused',
    GHL_CLIENT_ID: 'client', GHL_CLIENT_SECRET: 'secret', GHL_SHARED_SECRET: 'shared', GHL_APP_ID: 'app',
    ENCRYPTION_KEY: 'ab'.repeat(32), SESSION_SECRET: 'secret'.repeat(8) });
  const { singleApprovedLocation } = await import('../src/ghl/client.js');
  assert.equal(singleApprovedLocation({ ...base, userType: 'Location', locationId: 'loc' }), 'loc');
  assert.equal(singleApprovedLocation({ ...base, userType: 'Company', companyId: 'co', approvedLocations: ['loc'] }), 'loc');
  assert.throws(() => singleApprovedLocation({ ...base, userType: 'Company', companyId: 'co', approvedLocations: ['a', 'b'] }));
});
