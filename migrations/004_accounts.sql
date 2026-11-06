-- location_id is the internal workspace key. GHL location IDs are external references.
ALTER TABLE installations ADD COLUMN IF NOT EXISTS ghl_location_id text;
UPDATE installations SET ghl_location_id=location_id WHERE ghl_location_id IS NULL AND access_token<>'';
CREATE UNIQUE INDEX IF NOT EXISTS installations_ghl_location_idx ON installations(ghl_location_id) WHERE ghl_location_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workspace_members (
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  location_id text NOT NULL REFERENCES installations(location_id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','admin')),
  PRIMARY KEY(user_id,location_id)
);
CREATE TABLE IF NOT EXISTS email_signins (
  token_hash text PRIMARY KEY,
  email text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_signins_email_created_idx ON email_signins(email,created_at DESC);
CREATE TABLE IF NOT EXISTS account_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  location_id text NOT NULL REFERENCES installations(location_id) ON DELETE CASCADE,
  refresh_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS ghl_oauth_states (
  state_hash text PRIMARY KEY,
  location_id text NOT NULL REFERENCES installations(location_id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
