-- Shared workspace membership (multi-user per org/workspace).

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members (user_id);

CREATE TABLE IF NOT EXISTS workspace_invites (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by_user_id TEXT,
  accepted_at TEXT,
  accepted_user_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_workspace_invites_ws ON workspace_invites (workspace_id, created_at DESC);

-- Backfill: every existing user is a member of their home workspace.
INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
SELECT workspace_id, id, role, created_at FROM users
ON CONFLICT (workspace_id, user_id) DO NOTHING;
