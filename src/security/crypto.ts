import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual, verify } from 'node:crypto';
import CryptoJS from 'crypto-js';

export function encrypt(value: string, keyHex: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url');
}
export function decrypt(value: string, keyHex: string) {
  const data = Buffer.from(value, 'base64url');
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), data.subarray(0, 12));
  cipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([cipher.update(data.subarray(28)), cipher.final()]).toString('utf8');
}
export function signToken(payload: object, secret: string, ttlSeconds: number) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString('base64url');
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}
export function readToken<T>(token: string, secret: string): T | null {
  if (token.split('.').length !== 2) return null;
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = createHmac('sha256', secret).update(body).digest();
  const supplied = Buffer.from(mac, 'base64url');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const value = JSON.parse(Buffer.from(body, 'base64url').toString()) as T & { exp: number };
    return typeof value.exp === 'number' && Number.isFinite(value.exp) && value.exp > Date.now() / 1000 ? value : null;
  } catch { return null; }
}
export const GHL_WEBHOOK_PUBLIC_KEY = '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAi2HR1srL4o18O8BRa7gVJY7G7bupbN3H9AwJrHCDiOg=\n-----END PUBLIC KEY-----';
export function verifyGhlWebhook(raw: Buffer, signature?: string) {
  if (!signature) return false;
  try { return verify(null, raw, GHL_WEBHOOK_PUBLIC_KEY, Buffer.from(signature, 'base64')); }
  catch { return false; }
}
export function decryptGhlContext(encrypted: string, secret: string): unknown {
  const clear = CryptoJS.AES.decrypt(encrypted, secret).toString(CryptoJS.enc.Utf8);
  return JSON.parse(clear);
}
