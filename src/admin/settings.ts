import { pool } from '../db/pool.js';
import { getEnv } from '../config/env.js';
import { decrypt, encrypt } from '../security/crypto.js';

const SECRET_KEYS = new Set(['ai_api_key']);
let cache: { at: number; values: Map<string, string> } | null = null;

async function load() {
  if (cache && Date.now() - cache.at < 30_000) return cache.values;
  const values = new Map<string, string>();
  try {
    for (const row of (await pool.query('SELECT key,value,encrypted FROM app_settings')).rows) {
      try { values.set(row.key, row.encrypted ? decrypt(row.value, getEnv().ENCRYPTION_KEY) : row.value); } catch { /* unreadable value falls back to env */ }
    }
  } catch { return values; } // settings are optional overrides; an unavailable table must not take reporting down
  cache = { at: Date.now(), values };
  return values;
}
export async function getSetting(key: string) { return (await load()).get(key) || ''; }
export async function setSetting(key: string, value: string, updatedBy: string) {
  if (!value) await pool.query('DELETE FROM app_settings WHERE key=$1', [key]);
  else {
    const secret = SECRET_KEYS.has(key);
    await pool.query(`INSERT INTO app_settings(key,value,encrypted,updated_by) VALUES($1,$2,$3,$4)
      ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,encrypted=EXCLUDED.encrypted,updated_at=now(),updated_by=EXCLUDED.updated_by`,
      [key, secret ? encrypt(value, getEnv().ENCRYPTION_KEY) : value, secret, updatedBy]);
  }
  cache = null;
}
export function maskSecret(value: string) { return value ? `${value.slice(0, 3)}…${value.slice(-4)}` : ''; }
export async function aiConfig() {
  const env = getEnv();
  const dbKey = await getSetting('ai_api_key'), dbModel = await getSetting('ai_model');
  return { apiKey: dbKey || env.OPENAI_API_KEY, model: dbModel || env.AI_MODEL, keySource: dbKey ? 'db' as const : env.OPENAI_API_KEY ? 'env' as const : 'none' as const,
    modelSource: dbModel ? 'db' as const : env.AI_MODEL ? 'env' as const : 'none' as const };
}
