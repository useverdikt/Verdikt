-- Paired with backend/migrations/postgres/015_evidence_quality.sql
-- Catch-up for hosted Supabase track (schema previously only applied via API runMigrations).

-- Release-level evidence quality for cert governance (integration vs simulator vs mixed).
ALTER TABLE releases ADD COLUMN IF NOT EXISTS evidence_quality TEXT;
ALTER TABLE releases ADD COLUMN IF NOT EXISTS evidence_summary_json TEXT;

CREATE INDEX IF NOT EXISTS idx_releases_evidence_quality
  ON releases (workspace_id, evidence_quality)
  WHERE evidence_quality IS NOT NULL;
