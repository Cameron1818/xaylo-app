ALTER TABLE installations ADD COLUMN IF NOT EXISTS reporting_context jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS google_connections (
  location_id text PRIMARY KEY REFERENCES installations(location_id) ON DELETE CASCADE,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  connected_at timestamptz NOT NULL DEFAULT now()
);
-- Account references and explicit campaign mappings only; no Ads or CRM record mirror.
CREATE TABLE IF NOT EXISTS google_accounts (
  location_id text NOT NULL REFERENCES google_connections(location_id) ON DELETE CASCADE,
  customer_id text NOT NULL,
  login_customer_id text,
  name text NOT NULL,
  currency text NOT NULL,
  time_zone text NOT NULL,
  campaign_mappings jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY(location_id, customer_id)
);
CREATE TABLE IF NOT EXISTS google_oauth_states (
  state_hash text PRIMARY KEY,
  location_id text NOT NULL REFERENCES installations(location_id) ON DELETE CASCADE,
  verifier text NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS reports (
  id uuid PRIMARY KEY,
  location_id text NOT NULL REFERENCES installations(location_id) ON DELETE CASCADE,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  period jsonb NOT NULL,
  prompt_version text NOT NULL,
  model text NOT NULL,
  analysis jsonb NOT NULL,
  evidence jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS reports_location_created_idx ON reports(location_id, created_at DESC);
CREATE TABLE IF NOT EXISTS mcp_clients (
  id text PRIMARY KEY,
  name text NOT NULL,
  redirect_uris text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mcp_authorizations (
  id uuid PRIMARY KEY,
  user_code text NOT NULL UNIQUE,
  client_id text NOT NULL REFERENCES mcp_clients(id) ON DELETE CASCADE,
  redirect_uri text NOT NULL,
  state text NOT NULL,
  challenge text NOT NULL,
  scope text NOT NULL,
  location_id text REFERENCES installations(location_id) ON DELETE CASCADE,
  user_id text,
  code_hash text UNIQUE,
  issued boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS mcp_grants (
  id uuid PRIMARY KEY,
  client_id text NOT NULL REFERENCES mcp_clients(id) ON DELETE CASCADE,
  location_id text NOT NULL REFERENCES installations(location_id) ON DELETE CASCADE,
  user_id text NOT NULL,
  scope text NOT NULL,
  access_hash text NOT NULL UNIQUE,
  refresh_hash text NOT NULL UNIQUE,
  access_expires_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS events_conversion_once_idx ON events(location_id, visitor_id, session_id)
  WHERE event_type='conversion' AND session_id IS NOT NULL AND properties->>'deduplicate'='true';
