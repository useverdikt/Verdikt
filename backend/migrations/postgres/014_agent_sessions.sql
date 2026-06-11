-- Agent sessions: correlate audit events from one agent run (API key + session header).

CREATE TABLE IF NOT EXISTS agent_sessions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  api_key_id TEXT,
  label TEXT,
  started_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_agent_sessions_workspace
  ON agent_sessions (workspace_id, last_seen_at DESC);

ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS agent_session_id TEXT;

CREATE INDEX IF NOT EXISTS idx_audit_agent_session
  ON audit_events (agent_session_id, id DESC);
