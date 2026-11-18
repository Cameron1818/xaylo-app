import { readToken } from './crypto.js';
import { getEnv } from '../config/env.js';
import { pool } from '../db/pool.js';

export type Session = { locationId: string; userId: string; kind: 'session'; accountSessionId?: string; ghlLocationId?: string; preview?: boolean };
export function httpError(statusCode: number, message: string) { return Object.assign(new Error(message), { statusCode, publicMessage: message }); }
export function bearer(headers: Record<string, unknown>) {
  const auth = headers.authorization;
  return typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : '';
}
export async function assertActive(locationId: string) {
  const result = await pool.query("SELECT 1 FROM installations WHERE location_id=$1 AND status='active' AND suspended_at IS NULL", [locationId]);
  if (!result.rowCount) throw httpError(403, 'Location is not installed or has been suspended');
}
export async function requireSession(request: { headers: Record<string, unknown> }): Promise<Session> {
  const session = readToken<Session>(bearer(request.headers), getEnv().SESSION_SECRET);
  if (!session || session.kind !== 'session' || !session.locationId || !session.userId) throw httpError(401, 'Unauthorized');
  await assertActive(session.locationId);
  if (session.accountSessionId) {
    const valid = await pool.query(`SELECT 1 FROM account_sessions s JOIN workspace_members m ON m.user_id=s.user_id AND m.location_id=s.location_id
      WHERE s.id=$1 AND s.user_id=$2 AND s.location_id=$3 AND s.expires_at>now()`, [session.accountSessionId, session.userId, session.locationId]);
    if (!valid.rowCount) throw httpError(401, 'Sign in again');
  } else if (session.preview && getEnv().DEV_PREVIEW && process.env.NODE_ENV === 'development' && new URL(getEnv().PUBLIC_BASE_URL).hostname === 'localhost' && session.locationId === 'local-preview') {
    // Development-only sessions never bypass the active workspace check above.
  } else {
    if (!session.ghlLocationId) throw httpError(401, 'Open Xaylo in HighLevel again');
    const valid = await pool.query("SELECT 1 FROM installations WHERE location_id=$1 AND ghl_location_id=$2 AND status='active'", [session.locationId, session.ghlLocationId]);
    if (!valid.rowCount) throw httpError(401, 'HighLevel connection was disconnected');
  }
  return session;
}
export function isAdminEmail(email: string | null | undefined) {
  return Boolean(email) && getEnv().ADMIN_EMAILS.split(',').map(value => value.trim().toLowerCase()).filter(Boolean).includes(email!.toLowerCase());
}
export async function sessionEmail(userId: string) {
  // GHL-embedded sessions carry HighLevel user ids, which are not app_users ids and can never be admins.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) return undefined;
  return (await pool.query('SELECT email FROM app_users WHERE id=$1', [userId])).rows[0]?.email as string | undefined;
}
export async function requireAdmin(request: { headers: Record<string, unknown> }) {
  const session = await requireSession(request);
  const email = await sessionEmail(session.userId);
  if (!isAdminEmail(email)) throw httpError(403, 'Forbidden');
  return { ...session, email: email!.toLowerCase() };
}
