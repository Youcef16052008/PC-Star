-- PC Star persistent state for Neon Postgres.
-- The JSON document preserves the current domain model during the first migration.
-- The API must use the transactional adapter before production traffic is enabled.
CREATE TABLE IF NOT EXISTS pcstar_state (
  id integer PRIMARY KEY CHECK (id = 1),
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pcstar_state_updated_at_idx ON pcstar_state (updated_at);
