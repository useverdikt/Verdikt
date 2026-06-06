-- GitHub App install + repo selection for workspace-scoped label triggers.
CREATE TABLE IF NOT EXISTS github_app_installations (
  workspace_id TEXT PRIMARY KEY,
  installation_id BIGINT NOT NULL,
  account_login TEXT,
  account_type TEXT,
  installed_by_user_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_github_app_installations_installation
  ON github_app_installations(installation_id);

CREATE TABLE IF NOT EXISTS github_app_install_states (
  state TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  user_id TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_github_app_install_states_exp
  ON github_app_install_states(expires_at);

CREATE TABLE IF NOT EXISTS github_repo_connections (
  workspace_id TEXT NOT NULL,
  repository_id BIGINT NOT NULL,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  full_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, repository_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_github_repo_connections_full_name
  ON github_repo_connections(LOWER(full_name));

CREATE INDEX IF NOT EXISTS idx_github_repo_connections_ws
  ON github_repo_connections(workspace_id);
