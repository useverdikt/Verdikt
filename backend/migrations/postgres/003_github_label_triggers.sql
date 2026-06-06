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
