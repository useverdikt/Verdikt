-- Verdict-time evidence snapshots + append-only audit hash chain.

CREATE TABLE IF NOT EXISTS certification_snapshots (
  release_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  status_at_verdict TEXT NOT NULL,
  threshold_snapshot_json TEXT NOT NULL,
  signal_snapshot_json TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  frozen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_certification_snapshots_workspace
  ON certification_snapshots (workspace_id, frozen_at DESC);

ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS prev_hash TEXT;

-- Backfill per-workspace hash chain for existing audit rows (before immutability trigger).
-- Guarantees:
--   1. runMigrations.js wraps this entire file in BEGIN/COMMIT — backfill + trigger are atomic.
--   2. EXCLUSIVE lock blocks concurrent INSERT/UPDATE/DELETE from other API instances during deploy.
--   3. server.js calls initDatabase() (migrations) before app.listen() on each instance.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

LOCK TABLE audit_events IN EXCLUSIVE MODE;

DO $$
DECLARE
  ws TEXT;
  r RECORD;
  prev TEXT;
  canonical TEXT;
  row_digest TEXT;
BEGIN
  FOR ws IN SELECT DISTINCT workspace_id FROM audit_events ORDER BY workspace_id
  LOOP
    prev := 'GENESIS';
    FOR r IN
      SELECT id, workspace_id, release_id, event_type, actor_type, actor_name, details_json, created_at
      FROM audit_events
      WHERE workspace_id = ws
      ORDER BY id ASC
    LOOP
      canonical := json_build_object(
        'workspace_id', r.workspace_id,
        'release_id', r.release_id,
        'event_type', r.event_type,
        'actor_type', r.actor_type,
        'actor_name', r.actor_name,
        'details_json', COALESCE(r.details_json, NULL),
        'created_at', r.created_at,
        'prev_hash', prev
      )::text;
      row_digest := encode(digest(canonical, 'sha256'), 'hex');
      UPDATE audit_events
      SET prev_hash = prev, row_hash = row_digest
      WHERE id = r.id;
      prev := row_digest;
    END LOOP;
  END LOOP;
END $$;

-- Append-only: no updates or deletes after backfill.
CREATE OR REPLACE FUNCTION verdikt_audit_events_immutable()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS verdikt_audit_events_no_mutate ON audit_events;
CREATE TRIGGER verdikt_audit_events_no_mutate
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION verdikt_audit_events_immutable();
