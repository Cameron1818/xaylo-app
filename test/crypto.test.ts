import assert from 'node:assert/strict';
import test from 'node:test';
import { encrypt, decrypt, signToken, readToken, verifyGhlWebhook } from '../src/security/crypto.js';

test('stored tokens round trip with authenticated encryption', () => {
  const key = 'ab'.repeat(32);
  const sealed = encrypt('refresh-token', key);
  assert.equal(decrypt(sealed, key), 'refresh-token');
  assert.throws(() => decrypt(sealed, 'cd'.repeat(32)));
});

test('signed identity token rejects tampering', () => {
  const secret = 'secret'.repeat(8);
  const token = signToken({ locationId: 'loc', contactId: 'contact' }, secret, 60);
  assert.equal(readToken<{ contactId: string }>(token, secret)?.contactId, 'contact');
  assert.equal(readToken(token + 'x', secret), null);
});

test('webhook requires a valid signature', () => assert.equal(verifyGhlWebhook(Buffer.from('{}')), false));
