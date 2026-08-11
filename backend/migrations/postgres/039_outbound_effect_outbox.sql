-- Transactional intent log for post-verdict external deliveries.
-- Shadow mode records rows while legacy delivery remains authoritative.

CREATE TABLE IF NOT EXISTS outbound_effect_outbox (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  release_id TEXT NOT NULL REFERENCES releases(id) ON DELETE CASCADE,
  effect_type TEXT NOT NULL,
  source TEXT NOT NULL,
  verdict_status TEXT NOT NULL,
  verdict_issued_at TIMESTAMPTZ NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  envelope_json JSONB NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_by TEXT,
  claimed_until TIMESTAMPTZ,
  payload_json JSONB,
  payload_hash TEXT,
  shadow_result_json JSONB,
  last_error TEXT,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_outbound_effect_outbox_due
  ON outbound_effect_outbox (next_attempt_at, id)
  WHERE state IN ('pending', 'retry');

CREATE INDEX IF NOT EXISTS idx_outbound_effect_outbox_release
  ON outbound_effect_outbox (release_id, effect_type);

ALTER TABLE outbound_effect_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS outbound_effect_outbox_tenant ON outbound_effect_outbox;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'app_workspace_id'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY outbound_effect_outbox_tenant ON outbound_effect_outbox
        FOR ALL TO authenticated
        USING (workspace_id = app_workspace_id())
        WITH CHECK (workspace_id = app_workspace_id())
    $policy$;
  END IF;
END $$;
