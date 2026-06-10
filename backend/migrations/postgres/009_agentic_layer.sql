-- Agentic layer: workspace API keys for agent runtimes + per-release verdict callbacks.

CREATE TABLE IF NOT EXISTS workspace_api_keys (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  created_by_user_id TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_workspace_api_keys_workspace
  ON workspace_api_keys (workspace_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_api_keys_hash_active
  ON workspace_api_keys (key_hash)
  WHERE revoked_at IS NULL;

ALTER TABLE releases ADD COLUMN IF NOT EXISTS callback_url TEXT;
