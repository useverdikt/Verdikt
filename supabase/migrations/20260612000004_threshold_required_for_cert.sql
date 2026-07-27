-- Paired with backend/migrations/postgres/006_threshold_required_for_cert.sql
-- Catch-up for hosted Supabase track (schema previously only applied via API runMigrations).

-- Per-signal "required for certification" gate (Quality Thresholds UI toggle).
ALTER TABLE thresholds
  ADD COLUMN IF NOT EXISTS required_for_certification INTEGER NOT NULL DEFAULT 0;

-- Default AI eval signals required for existing workspaces; deltas and perf stay optional until enabled.
UPDATE thresholds
SET required_for_certification = 1
WHERE signal_id IN ('accuracy', 'safety', 'tone', 'hallucination', 'relevance');
