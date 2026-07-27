-- Paired with backend/migrations/postgres/023_calibration_mode.sql
-- Catch-up for hosted Supabase track (schema previously only applied via API runMigrations).

-- Opt-in calibration auto-apply for design partners (default: suggest_only).
ALTER TABLE workspace_policies
  ADD COLUMN IF NOT EXISTS calibration_mode TEXT NOT NULL DEFAULT 'suggest_only';
