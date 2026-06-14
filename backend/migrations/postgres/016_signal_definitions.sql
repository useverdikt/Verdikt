-- Workspace-owned signal definitions, Verdikt signal library, connector declarations.

CREATE TABLE IF NOT EXISTS signal_library (
  signal_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT,
  direction TEXT NOT NULL DEFAULT 'min',
  unit TEXT,
  suggested_threshold_json TEXT,
  source_hints_json TEXT NOT NULL DEFAULT '[]',
  category TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS connector_signal_map (
  source_id TEXT NOT NULL,
  signal_id TEXT NOT NULL,
  display_name TEXT,
  direction TEXT,
  ingest_mode TEXT NOT NULL DEFAULT 'pull',
  PRIMARY KEY (source_id, signal_id)
);

CREATE TABLE IF NOT EXISTS workspace_signal_definitions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  signal_id TEXT NOT NULL,
  display_name TEXT,
  description TEXT,
  direction TEXT NOT NULL DEFAULT 'min',
  unit TEXT,
  source_id TEXT,
  from_library INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, signal_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_signal_definitions_ws
  ON workspace_signal_definitions (workspace_id);
