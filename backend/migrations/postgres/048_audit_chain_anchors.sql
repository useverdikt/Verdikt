-- Signed audit-chain tip witnesses. Append-only; never write AUDIT_CHAIN_ANCHORED
-- events (that would move the tip being anchored).

CREATE TABLE IF NOT EXISTS audit_chain_anchors (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  tip_event_id BIGINT NOT NULL,
  tip_row_hash TEXT NOT NULL,
  event_count INTEGER NOT NULL,
  anchored_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  algorithm TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  signature TEXT NOT NULL,
  signed_payload TEXT NOT NULL,
  public_key_hint TEXT,
  public_key_pem TEXT,
  external_kind TEXT NOT NULL DEFAULT 'none',
  external_ref TEXT,
  external_proof_json TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT audit_chain_anchors_external_kind_check
    CHECK (external_kind IN ('none', 'https'))
);

CREATE INDEX IF NOT EXISTS idx_audit_chain_anchors_workspace_anchored
  ON audit_chain_anchors (workspace_id, anchored_at DESC, id DESC);

ALTER TABLE audit_chain_anchors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_chain_anchors_tenant ON audit_chain_anchors;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'app_workspace_id'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY audit_chain_anchors_tenant ON audit_chain_anchors
        FOR ALL TO authenticated
        USING (workspace_id = app_workspace_id())
        WITH CHECK (workspace_id = app_workspace_id())
    $policy$;
  END IF;
END $$;

DO $$
BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE audit_chain_anchors TO authenticated;
EXCEPTION
  WHEN undefined_object THEN
    RAISE NOTICE 'verdikt: skipping authenticated grant on audit_chain_anchors';
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'verdikt: skipping authenticated grant on audit_chain_anchors';
END $$;
