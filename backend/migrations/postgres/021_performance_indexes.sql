-- Three covering indexes that remove full table scans on hot query paths.
--
-- 1. signals(release_id, signal_name) — getLatestSignalMap fetches all signals
--    for a release; adding signal_name as a covering column avoids a heap fetch
--    for the common "get latest value per signal" query.
--
-- 2. releases(workspace_id, status, created_at DESC) — used by loop-readiness,
--    production-health, and the verdict pipeline to filter active/pending
--    releases within a workspace. Composite keeps the sort on the index.
--
-- 3. audit_events(release_id, event_type) — audit queries often filter on
--    (release_id, event_type) when surfacing the latest verdict event; the
--    existing idx_audit_release_id covers only release_id.

CREATE INDEX IF NOT EXISTS idx_signals_release_signal
  ON signals(release_id, signal_name);

CREATE INDEX IF NOT EXISTS idx_releases_workspace_status_created
  ON releases(workspace_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_release_event_type
  ON audit_events(release_id, event_type);
