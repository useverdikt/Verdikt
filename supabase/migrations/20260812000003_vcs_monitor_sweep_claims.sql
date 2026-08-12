-- Durable leases prevent multiple worker replicas from scanning the same VCS
-- monitoring window. Leases recover automatically after worker exit.

CREATE TABLE IF NOT EXISTS vcs_monitor_sweep_claims (
  release_id TEXT PRIMARY KEY REFERENCES vcs_monitoring_windows(release_id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  claimed_by TEXT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_until TIMESTAMPTZ NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vcs_monitor_sweep_claims_lease
  ON vcs_monitor_sweep_claims (lease_until);

ALTER TABLE vcs_monitor_sweep_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vcs_monitor_sweep_claims_tenant ON vcs_monitor_sweep_claims;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'app_workspace_id'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY vcs_monitor_sweep_claims_tenant ON vcs_monitor_sweep_claims
        FOR ALL TO authenticated
        USING (workspace_id = app_workspace_id())
        WITH CHECK (workspace_id = app_workspace_id())
    $policy$;
  END IF;
END $$;
