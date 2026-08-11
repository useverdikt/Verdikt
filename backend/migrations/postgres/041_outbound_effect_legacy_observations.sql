ALTER TABLE outbound_effect_outbox
  ADD COLUMN IF NOT EXISTS legacy_comparison_json JSONB,
  ADD COLUMN IF NOT EXISTS legacy_comparison_hash TEXT,
  ADD COLUMN IF NOT EXISTS legacy_observed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS legacy_response_status INTEGER,
  ADD COLUMN IF NOT EXISTS legacy_error_code TEXT;
