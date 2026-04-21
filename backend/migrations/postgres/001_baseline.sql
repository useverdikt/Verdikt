-- PostgreSQL baseline (squashed from SQLite migrations 001–014). New installs run this once.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT,
  workspace_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'ai_product_lead',
  created_at TEXT NOT NULL,
  auth_user_id TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_auth_user_id ON users (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS thresholds (
  workspace_id TEXT NOT NULL,
  signal_id TEXT NOT NULL,
  min_value DOUBLE PRECISION,
  max_value DOUBLE PRECISION,
  PRIMARY KEY (workspace_id, signal_id)
);

CREATE TABLE IF NOT EXISTS workspace_policies (
  workspace_id TEXT PRIMARY KEY,
  require_ai_eval INTEGER NOT NULL DEFAULT 1,
  ai_missing_policy TEXT NOT NULL DEFAULT 'block_uncertified',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  cert_expiry_days INTEGER,
  collection_timeout_policy TEXT NOT NULL DEFAULT 'block_uncertified'
);

CREATE TABLE IF NOT EXISTS releases (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  version TEXT NOT NULL,
  release_type TEXT NOT NULL,
  environment TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  release_ref TEXT,
  trigger_source TEXT,
  mappings_json TEXT,
  collection_deadline TEXT,
  verdict_issued_at TEXT,
  ai_context_json TEXT,
  commit_sha TEXT,
  pr_number INTEGER
);

CREATE TABLE IF NOT EXISTS webhook_events (
  idempotency_key TEXT PRIMARY KEY,
  release_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS signals (
  id BIGSERIAL PRIMARY KEY,
  release_id TEXT NOT NULL,
  signal_id TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  source TEXT,
  created_at TEXT NOT NULL,
  idempotency_key TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_signals_idempotency
  ON signals(release_id, signal_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS overrides (
  id BIGSERIAL PRIMARY KEY,
  release_id TEXT NOT NULL UNIQUE,
  approver_type TEXT NOT NULL,
  approver_name TEXT NOT NULL,
  approver_role TEXT,
  justification TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  release_id TEXT,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL,
  row_hash TEXT
);

CREATE TABLE IF NOT EXISTS release_intelligence (
  release_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  verdict_json TEXT,
  override_json TEXT,
  trace_json TEXT,
  decision_json TEXT,
  outcome_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  baseline_health_json TEXT,
  early_warning_json TEXT
);

CREATE TABLE IF NOT EXISTS override_history (
  id BIGSERIAL PRIMARY KEY,
  release_id TEXT NOT NULL,
  approver_type TEXT NOT NULL,
  approver_name TEXT NOT NULL,
  approver_role TEXT,
  justification TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS release_deltas (
  id BIGSERIAL PRIMARY KEY,
  release_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  signal_id TEXT NOT NULL,
  baseline_release_id TEXT,
  baseline_value DOUBLE PRECISION,
  current_value DOUBLE PRECISION,
  max_allowed_drop DOUBLE PRECISION NOT NULL,
  drop_amount DOUBLE PRECISION,
  passed INTEGER NOT NULL,
  computed_at TEXT NOT NULL,
  UNIQUE(release_id, signal_id)
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cert_signatures (
  release_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  algorithm TEXT NOT NULL DEFAULT 'sha256',
  payload_hash TEXT NOT NULL,
  signature TEXT NOT NULL,
  signed_at TEXT NOT NULL,
  signed_by TEXT NOT NULL DEFAULT 'system',
  public_key_hint TEXT
);

CREATE TABLE IF NOT EXISTS baseline_policies (
  workspace_id TEXT PRIMARY KEY,
  strategy TEXT NOT NULL DEFAULT 'median_n',
  window_n INTEGER NOT NULL DEFAULT 5,
  pinned_release_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS release_early_warnings (
  release_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  computed_at TEXT NOT NULL,
  sample_pct DOUBLE PRECISION,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  overall_risk TEXT NOT NULL DEFAULT 'stable',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbound_webhooks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL UNIQUE,
  url TEXT NOT NULL,
  secret TEXT,
  events TEXT NOT NULL DEFAULT 'CERTIFIED,UNCERTIFIED,CERTIFIED_WITH_OVERRIDE',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS outbound_webhook_deliveries (
  id BIGSERIAL PRIMARY KEY,
  webhook_id TEXT NOT NULL,
  release_id TEXT,
  event_type TEXT NOT NULL,
  payload_json TEXT,
  response_status INTEGER,
  error_message TEXT,
  delivered_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS signal_schema (
  workspace_id TEXT NOT NULL,
  signal_id TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  required INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, signal_id)
);

CREATE TABLE IF NOT EXISTS signal_correlations (
  id BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  signal_a TEXT NOT NULL,
  signal_b TEXT NOT NULL,
  correlation DOUBLE PRECISION NOT NULL,
  sample_count INTEGER NOT NULL,
  computed_at TEXT NOT NULL,
  UNIQUE(workspace_id, signal_a, signal_b)
);

CREATE TABLE IF NOT EXISTS failure_mode_classifications (
  release_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  failure_mode TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL,
  signals_json TEXT NOT NULL,
  computed_at TEXT NOT NULL,
  PRIMARY KEY (release_id, failure_mode)
);

CREATE TABLE IF NOT EXISTS env_chains (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  environments TEXT NOT NULL,
  require_all INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS env_chain_links (
  id BIGSERIAL PRIMARY KEY,
  chain_id TEXT NOT NULL,
  release_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  certified_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(chain_id, environment)
);

CREATE TABLE IF NOT EXISTS sse_tokens (
  token TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  release_id TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vcs_integrations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL DEFAULT 'github',
  access_token TEXT NOT NULL,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vcs_status_deliveries (
  id BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  release_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  commit_sha TEXT,
  pr_number INTEGER,
  status_sent TEXT NOT NULL,
  response_code INTEGER,
  error_message TEXT,
  delivered_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS override_analytics_cache (
  workspace_id TEXT PRIMARY KEY,
  computed_at TEXT NOT NULL,
  total_overrides INTEGER NOT NULL DEFAULT 0,
  override_rate_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  top_approvers TEXT NOT NULL DEFAULT '[]',
  top_signals TEXT NOT NULL DEFAULT '[]',
  risk_distribution TEXT NOT NULL DEFAULT '{}',
  trend_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS signal_reliability (
  workspace_id TEXT NOT NULL,
  signal_id TEXT NOT NULL,
  computed_at TEXT NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  on_time_rate DOUBLE PRECISION NOT NULL DEFAULT 0,
  variance_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  reliability DOUBLE PRECISION NOT NULL DEFAULT 0,
  grade TEXT NOT NULL DEFAULT 'unknown',
  PRIMARY KEY (workspace_id, signal_id)
);

CREATE TABLE IF NOT EXISTS production_observations (
  id BIGSERIAL PRIMARY KEY,
  release_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  signal_name TEXT NOT NULL,
  value DOUBLE PRECISION NOT NULL,
  observed_at TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'webhook',
  idempotency_key TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_prod_obs_idempotency
  ON production_observations(release_id, signal_name, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS outcome_alignments (
  release_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  recommended_verdict TEXT,
  actual_outcome TEXT,
  alignment TEXT,
  signal_deltas_json TEXT,
  computed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  outcome_criteria_json TEXT,
  incident_ref TEXT,
  over_block_suggestions_json TEXT
);

CREATE TABLE IF NOT EXISTS production_adjustment_cache (
  workspace_id TEXT PRIMARY KEY,
  computed_at TEXT NOT NULL,
  miss_rate_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  over_block_rate_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  signal_drift_json TEXT NOT NULL DEFAULT '{}',
  confidence_modifier DOUBLE PRECISION NOT NULL DEFAULT 0,
  sample_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS signal_integrations (
  workspace_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  api_key TEXT NOT NULL,
  extra_json TEXT,
  verified_at TEXT,
  last_verify_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (workspace_id, source_id)
);

CREATE TABLE IF NOT EXISTS signal_csv_imports (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  columns_json TEXT NOT NULL,
  preview_json TEXT NOT NULL,
  rows_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS waitlist_requests (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  company TEXT NOT NULL,
  role TEXT,
  message TEXT,
  created_at TEXT NOT NULL,
  source_ip TEXT,
  q_role TEXT,
  q_team_size TEXT,
  q_release_process TEXT,
  q_pain_points TEXT,
  q_goal TEXT
);

CREATE TABLE IF NOT EXISTS vcs_monitoring_windows (
  release_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  commit_sha TEXT,
  pr_number INTEGER,
  monitoring_start TEXT NOT NULL,
  monitoring_end TEXT NOT NULL,
  window_minutes INTEGER NOT NULL DEFAULT 120,
  status TEXT NOT NULL DEFAULT 'pending',
  last_scanned_at TEXT,
  scan_count INTEGER NOT NULL DEFAULT 0,
  findings_json TEXT,
  inferred_signals_json TEXT,
  inferred_outcome TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_signals_release_id ON signals(release_id);
CREATE INDEX IF NOT EXISTS idx_releases_workspace_created ON releases(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_workspace_id ON audit_events(workspace_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_audit_release_id ON audit_events(release_id);
CREATE INDEX IF NOT EXISTS idx_override_history_release ON override_history(release_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_release_deltas_release ON release_deltas(release_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_token_hash ON password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_password_reset_user ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_cert_signatures_workspace ON cert_signatures(workspace_id, signed_at DESC);
CREATE INDEX IF NOT EXISTS idx_early_warnings_workspace ON release_early_warnings(workspace_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook ON outbound_webhook_deliveries(webhook_id, delivered_at DESC);
CREATE INDEX IF NOT EXISTS idx_correlations_ws ON signal_correlations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_failure_modes_ws ON failure_mode_classifications(workspace_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_env_chains_ws ON env_chains(workspace_id);
CREATE INDEX IF NOT EXISTS idx_chain_links_chain ON env_chain_links(chain_id);
CREATE INDEX IF NOT EXISTS idx_chain_links_release ON env_chain_links(release_id);
CREATE INDEX IF NOT EXISTS idx_sse_tokens_release ON sse_tokens(release_id);
CREATE INDEX IF NOT EXISTS idx_vcs_deliveries_release ON vcs_status_deliveries(release_id);
CREATE INDEX IF NOT EXISTS idx_reliability_ws ON signal_reliability(workspace_id);
CREATE INDEX IF NOT EXISTS idx_prod_obs_release ON production_observations(release_id, signal_name);
CREATE INDEX IF NOT EXISTS idx_prod_obs_workspace ON production_observations(workspace_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS idx_outcome_workspace ON outcome_alignments(workspace_id, computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_signal_csv_imports_workspace ON signal_csv_imports(workspace_id);
CREATE INDEX IF NOT EXISTS idx_waitlist_requests_created ON waitlist_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_waitlist_requests_email ON waitlist_requests(email);
CREATE INDEX IF NOT EXISTS idx_vcs_windows_status ON vcs_monitoring_windows(status, monitoring_end);
CREATE INDEX IF NOT EXISTS idx_vcs_windows_workspace ON vcs_monitoring_windows(workspace_id, created_at DESC);
