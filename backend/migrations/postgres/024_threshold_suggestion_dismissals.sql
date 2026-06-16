-- Persist threshold suggestion dismissals (stable by signal + direction + source).
CREATE TABLE IF NOT EXISTS threshold_suggestion_dismissals (
  workspace_id TEXT NOT NULL,
  signal_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'any',
  suggestion_id TEXT,
  reason TEXT,
  dismissed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, signal_id, direction, source)
);

CREATE INDEX IF NOT EXISTS idx_threshold_dismissals_workspace
  ON threshold_suggestion_dismissals (workspace_id, dismissed_at DESC);
