import { pool } from './pool.js';

export async function expireTransientData() {
  await pool.query("DELETE FROM report_usage WHERE status='pending' AND expires_at<now()");
  await pool.query("DELETE FROM billing_receipts WHERE received_at<now()-interval '90 days'");
  // Reports are deliberately retained until deleted by their owner.
  await pool.query("DELETE FROM events WHERE created_at < now() - interval '90 days'");
  await pool.query('DELETE FROM google_oauth_states WHERE expires_at < now()');
  await pool.query('DELETE FROM ghl_oauth_states WHERE expires_at < now()');
  await pool.query('DELETE FROM email_signins WHERE expires_at < now()');
  await pool.query('DELETE FROM account_sessions WHERE expires_at < now()');
  await pool.query('DELETE FROM mcp_authorizations WHERE expires_at < now()');
  await pool.query('DELETE FROM mcp_grants WHERE expires_at < now()');
  await pool.query("DELETE FROM webhook_receipts WHERE received_at < now() - interval '90 days'");
  await pool.query("DELETE FROM mcp_clients c WHERE c.created_at < now() - interval '1 day' AND NOT EXISTS (SELECT 1 FROM mcp_grants g WHERE g.client_id=c.id) AND NOT EXISTS (SELECT 1 FROM mcp_authorizations a WHERE a.client_id=c.id)");
}
