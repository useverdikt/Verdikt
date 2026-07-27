-- Paired with backend/migrations/postgres/010_release_identity.sql
-- Catch-up for hosted Supabase track (schema previously only applied via API runMigrations).

-- Release identity: GitHub repo context + indexes for SHA/PR correlation.

ALTER TABLE releases ADD COLUMN IF NOT EXISTS github_owner TEXT;
ALTER TABLE releases ADD COLUMN IF NOT EXISTS github_repo TEXT;
ALTER TABLE releases ADD COLUMN IF NOT EXISTS github_branch TEXT;

CREATE INDEX IF NOT EXISTS idx_releases_workspace_commit_sha
  ON releases (workspace_id, commit_sha)
  WHERE commit_sha IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_releases_identity_collecting
  ON releases (workspace_id, github_owner, github_repo, pr_number, commit_sha)
  WHERE status = 'COLLECTING';
