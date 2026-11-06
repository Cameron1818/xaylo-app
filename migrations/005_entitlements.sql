ALTER TABLE installations ADD COLUMN IF NOT EXISTS trial_started_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE installations ADD COLUMN IF NOT EXISTS stripe_customer_id text UNIQUE;
ALTER TABLE installations ADD COLUMN IF NOT EXISTS stripe_subscription_id text UNIQUE;
CREATE TABLE IF NOT EXISTS report_usage (
  id uuid PRIMARY KEY,
  location_id text NOT NULL REFERENCES installations(location_id) ON DELETE CASCADE,
  window_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','completed')),
  expires_at timestamptz NOT NULL,
  report_id uuid REFERENCES reports(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS report_usage_location_window_idx ON report_usage(location_id,window_key);
CREATE TABLE IF NOT EXISTS billing_receipts (
  event_id text PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now()
);
