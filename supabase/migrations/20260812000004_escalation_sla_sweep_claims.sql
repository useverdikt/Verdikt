-- Durable leases prevent worker replicas from writing duplicate escalation SLA
-- audits or sending concurrent reminder emails.

CREATE TABLE IF NOT EXISTS escalation_sla_sweep_claims (
  escalation_id TEXT PRIMARY KEY REFERENCES escalation_requests(id) ON DELETE CASCADE,
  workspace_id TEXT NOT NULL,
  claimed_by TEXT NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_until TIMESTAMPTZ NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 1,
  last_error TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_escalation_sla_sweep_claims_lease
  ON escalation_sla_sweep_claims (lease_until);

CREATE INDEX IF NOT EXISTS idx_escalation_requests_sla_due
  ON escalation_requests (sla_due_at, id)
  WHERE state = 'pending_human_review'
    AND (sla_breached = 0 OR sla_reminder_sent_at IS NULL);

ALTER TABLE escalation_sla_sweep_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS escalation_sla_sweep_claims_tenant ON escalation_sla_sweep_claims;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'app_workspace_id'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY escalation_sla_sweep_claims_tenant ON escalation_sla_sweep_claims
        FOR ALL TO authenticated
        USING (workspace_id = app_workspace_id())
        WITH CHECK (workspace_id = app_workspace_id())
    $policy$;
  END IF;
END $$;
