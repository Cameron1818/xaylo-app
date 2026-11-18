ALTER TABLE installations ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  encrypted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text
);
CREATE TABLE IF NOT EXISTS admin_audit (
  id uuid PRIMARY KEY,
  admin_email text NOT NULL,
  action text NOT NULL,
  target text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON admin_audit(created_at DESC);
