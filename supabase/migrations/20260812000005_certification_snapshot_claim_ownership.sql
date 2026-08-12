-- Make retry completion owner-scoped and prevent concurrent startup backfills
-- from rebuilding the same certification snapshot.

ALTER TABLE certification_snapshot_retries
  ADD COLUMN IF NOT EXISTS claimed_by TEXT,
  ADD COLUMN IF NOT EXISTS lease_until TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_cert_snapshot_retries_claim
  ON certification_snapshot_retries (next_attempt_at, lease_until);

CREATE TABLE IF NOT EXISTS certification_snapshot_backfill_claims (
  release_id TEXT PRIMARY KEY REFERENCES releases(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  claimed_by TEXT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_until TIMESTAMPTZ NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cert_snapshot_backfill_claims_lease
  ON certification_snapshot_backfill_claims (lease_until);

ALTER TABLE certification_snapshot_backfill_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS certification_snapshot_backfill_claims_tenant
  ON certification_snapshot_backfill_claims;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'app_workspace_id'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY certification_snapshot_backfill_claims_tenant
        ON certification_snapshot_backfill_claims
        FOR ALL TO authenticated
        USING (workspace_id = app_workspace_id())
        WITH CHECK (workspace_id = app_workspace_id())
    $policy$;
  END IF;
END $$;
