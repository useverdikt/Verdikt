-- Cert record visibility preferences and Slack notification URL stored in
-- workspace_policies. All three visibility flags default to TRUE (public)
-- to match the previous hardcoded behaviour.

ALTER TABLE workspace_policies
  ADD COLUMN IF NOT EXISTS public_cert_records     BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS show_signal_detail       BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS show_override_justification BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS slack_webhook_url        TEXT    DEFAULT NULL;
