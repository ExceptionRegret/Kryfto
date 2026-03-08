-- Add token expiration support
ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Rate limit configuration per role
CREATE TABLE IF NOT EXISTS rate_limit_config (
  role role PRIMARY KEY,
  rpm INTEGER NOT NULL DEFAULT 120,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed defaults
INSERT INTO rate_limit_config (role, rpm) VALUES
  ('admin', 500),
  ('developer', 120),
  ('readonly', 60)
ON CONFLICT (role) DO NOTHING;
