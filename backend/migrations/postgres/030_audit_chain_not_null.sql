-- Require hash chain fields on all new audit rows (fail-closed runtime writes).
-- Backfill any rows that were inserted with null hashes before fail-closed writeAudit.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

LOCK TABLE audit_events IN EXCLUSIVE MODE;

ALTER TABLE audit_events DISABLE TRIGGER verdikt_audit_events_no_mutate;

DO $$
DECLARE
  ws TEXT;
  r RECORD;
  prev TEXT;
  canonical TEXT;
  row_digest TEXT;
BEGIN
  FOR ws IN
    SELECT DISTINCT workspace_id
    FROM audit_events
    WHERE prev_hash IS NULL OR row_hash IS NULL
    ORDER BY workspace_id
  LOOP
    SELECT row_hash INTO prev
    FROM audit_events
    WHERE workspace_id = ws AND row_hash IS NOT NULL
    ORDER BY id DESC
    LIMIT 1;

    prev := COALESCE(prev, 'GENESIS');

    FOR r IN
      SELECT id, workspace_id, release_id, event_type, actor_type, actor_name, details_json, created_at, prev_hash, row_hash
      FROM audit_events
      WHERE workspace_id = ws
        AND (prev_hash IS NULL OR row_hash IS NULL)
      ORDER BY id ASC
    LOOP
      IF r.row_hash IS NOT NULL THEN
        prev := r.row_hash;
        CONTINUE;
      END IF;

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

ALTER TABLE audit_events ENABLE TRIGGER verdikt_audit_events_no_mutate;

ALTER TABLE audit_events ALTER COLUMN prev_hash SET NOT NULL;
ALTER TABLE audit_events ALTER COLUMN row_hash SET NOT NULL;
