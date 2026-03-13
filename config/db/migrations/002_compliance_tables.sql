CREATE TABLE IF NOT EXISTS user_terms_acceptance (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  terms_version TEXT NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_hash TEXT NOT NULL,
  ua_hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_terms_acceptance_user_id
  ON user_terms_acceptance (user_id, accepted_at DESC);

CREATE TABLE IF NOT EXISTS auth_events (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT,
  event_type TEXT NOT NULL,
  provider TEXT,
  success BOOLEAN NOT NULL,
  ip_hash TEXT NOT NULL,
  ua_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_events_created_at
  ON auth_events (created_at DESC);
