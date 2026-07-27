-- Paired with backend/migrations/postgres/017_signal_definition_detach.sql
-- Catch-up for hosted Supabase track (schema previously only applied via API runMigrations).

-- Soft-detach library signals from workspace gating while preserving threshold tuning.
ALTER TABLE workspace_signal_definitions
  ADD COLUMN IF NOT EXISTS detached_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_workspace_signal_definitions_active
  ON workspace_signal_definitions (workspace_id)
  WHERE detached_at IS NULL;
