-- Self-serve requests for new pull integrations (Signal Sources → Request integration).

CREATE TABLE IF NOT EXISTS integration_requests (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  source_name TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  created_by_email TEXT,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_integration_requests_workspace
  ON integration_requests (workspace_id, created_at DESC);
