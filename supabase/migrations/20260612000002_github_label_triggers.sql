-- Paired with backend/migrations/postgres/003_github_label_triggers.sql
-- Catch-up for hosted Supabase track (schema previously only applied via API runMigrations).

-- GitHub label-trigger automation config per workspace.
CREATE TABLE IF NOT EXISTS github_label_triggers (
  workspace_id TEXT PRIMARY KEY,
  label_name TEXT NOT NULL DEFAULT 'verdikt:rc',
  enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_github_label_triggers_enabled
  ON github_label_triggers(enabled);
