-- Paired with backend/migrations/postgres/036_certification_snapshot_retry_queue.sql
-- Durable queue for certification snapshot persist retries.

CREATE TABLE IF NOT EXISTS certification_snapshot_retries (
  release_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  status_at_verdict TEXT NOT NULL,
  threshold_snapshot_json TEXT NOT NULL,
  signal_snapshot_json TEXT NOT NULL,
  allow_update INTEGER NOT NULL DEFAULT 0,
  attempt INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cert_snapshot_retries_due
  ON certification_snapshot_retries (next_attempt_at);

ALTER TABLE certification_snapshot_retries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS certification_snapshot_retries_tenant ON certification_snapshot_retries;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'app_workspace_id'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY certification_snapshot_retries_tenant ON certification_snapshot_retries
        FOR ALL TO authenticated
        USING (workspace_id = app_workspace_id())
        WITH CHECK (workspace_id = app_workspace_id())
    $policy$;
  END IF;
END $$;
