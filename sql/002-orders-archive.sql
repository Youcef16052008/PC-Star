-- PC Star order archive for Neon Postgres.
-- Completed/picked orders older than a retention window are moved here from
-- the hot pcstar_state JSONB document to keep it lean under concurrent traffic.
CREATE TABLE IF NOT EXISTS pcstar_archived_orders (
  code text PRIMARY KEY,
  data jsonb NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pcstar_archived_orders_at_idx ON pcstar_archived_orders (archived_at);
