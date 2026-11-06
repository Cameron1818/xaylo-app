CREATE TABLE IF NOT EXISTS installations (
  location_id text PRIMARY KEY,
  company_id text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','uninstalled')),
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  site_key text NOT NULL UNIQUE,
  allowed_origins text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS journeys (
  id uuid PRIMARY KEY,
  location_id text NOT NULL REFERENCES installations(location_id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  priority integer NOT NULL DEFAULT 0,
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  add_tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (location_id, slug)
);
CREATE INDEX IF NOT EXISTS journeys_match_idx ON journeys(location_id, status, priority DESC);
CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY,
  location_id text NOT NULL REFERENCES installations(location_id) ON DELETE CASCADE,
  journey_id uuid REFERENCES journeys(id) ON DELETE SET NULL,
  contact_id text,
  visitor_id text NOT NULL,
  event_type text NOT NULL,
  page_url text,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS events_location_created_idx ON events(location_id, created_at DESC);
CREATE TABLE IF NOT EXISTS webhook_receipts (
  webhook_id text PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now()
);
