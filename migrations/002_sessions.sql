ALTER TABLE events ADD COLUMN IF NOT EXISTS session_id uuid;
CREATE INDEX IF NOT EXISTS events_location_session_idx ON events(location_id, session_id, created_at);
