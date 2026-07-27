-- Paired with backend/migrations/postgres/022_workspace_cert_visibility.sql
-- Catch-up for hosted Supabase track (schema previously only applied via API runMigrations).

-- Cert record visibility preferences and Slack notification URL stored in
-- workspace_policies. All three visibility flags default to TRUE (public)
-- to match the previous hardcoded behaviour.

ALTER TABLE workspace_policies
  ADD COLUMN IF NOT EXISTS public_cert_records     BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS show_signal_detail       BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS show_override_justification BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS slack_webhook_url        TEXT    DEFAULT NULL;
