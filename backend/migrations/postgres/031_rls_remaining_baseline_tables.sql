-- Enable RLS + tenant policies on remaining baseline tables exposed via PostgREST.
-- Backend connects as table owner (bypasses RLS) so app behavior is unchanged.
-- Closes the Supabase "RLS disabled in public" lint for workspace/release-scoped tables
-- that were created in 001/028 without policies (see 025 grant on all public tables).

-- ─── workspace-scoped tables ────────────────────────────────────────────────

ALTER TABLE certification_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS certification_snapshots_tenant ON certification_snapshots;
CREATE POLICY certification_snapshots_tenant ON certification_snapshots FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE vcs_monitoring_windows ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vcs_monitoring_windows_tenant ON vcs_monitoring_windows;
CREATE POLICY vcs_monitoring_windows_tenant ON vcs_monitoring_windows FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE cert_signatures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cert_signatures_tenant ON cert_signatures;
CREATE POLICY cert_signatures_tenant ON cert_signatures FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE release_deltas ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS release_deltas_tenant ON release_deltas;
CREATE POLICY release_deltas_tenant ON release_deltas FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE signal_correlations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS signal_correlations_tenant ON signal_correlations;
CREATE POLICY signal_correlations_tenant ON signal_correlations FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE failure_mode_classifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS failure_mode_classifications_tenant ON failure_mode_classifications;
CREATE POLICY failure_mode_classifications_tenant ON failure_mode_classifications FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE signal_reliability ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS signal_reliability_tenant ON signal_reliability;
CREATE POLICY signal_reliability_tenant ON signal_reliability FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE override_analytics_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS override_analytics_cache_tenant ON override_analytics_cache;
CREATE POLICY override_analytics_cache_tenant ON override_analytics_cache FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE production_adjustment_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS production_adjustment_cache_tenant ON production_adjustment_cache;
CREATE POLICY production_adjustment_cache_tenant ON production_adjustment_cache FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE env_chains ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS env_chains_tenant ON env_chains;
CREATE POLICY env_chains_tenant ON env_chains FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

-- ─── release-keyed tables (no workspace_id column) ──────────────────────────

ALTER TABLE env_chain_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS env_chain_links_tenant ON env_chain_links;
CREATE POLICY env_chain_links_tenant ON env_chain_links FOR ALL TO authenticated
  USING (app_release_in_workspace(release_id)) WITH CHECK (app_release_in_workspace(release_id));

ALTER TABLE override_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS override_history_tenant ON override_history;
CREATE POLICY override_history_tenant ON override_history FOR ALL TO authenticated
  USING (app_release_in_workspace(release_id)) WITH CHECK (app_release_in_workspace(release_id));

-- ─── remaining workspace-scoped tables (incl. secret-holding) ──────────────

ALTER TABLE baseline_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS baseline_policies_tenant ON baseline_policies;
CREATE POLICY baseline_policies_tenant ON baseline_policies FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE release_early_warnings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS release_early_warnings_tenant ON release_early_warnings;
CREATE POLICY release_early_warnings_tenant ON release_early_warnings FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE outbound_webhooks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS outbound_webhooks_tenant ON outbound_webhooks;
CREATE POLICY outbound_webhooks_tenant ON outbound_webhooks FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE signal_schema ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS signal_schema_tenant ON signal_schema;
CREATE POLICY signal_schema_tenant ON signal_schema FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE sse_tokens ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sse_tokens_tenant ON sse_tokens;
CREATE POLICY sse_tokens_tenant ON sse_tokens FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE vcs_integrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vcs_integrations_tenant ON vcs_integrations;
CREATE POLICY vcs_integrations_tenant ON vcs_integrations FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE vcs_status_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vcs_status_deliveries_tenant ON vcs_status_deliveries;
CREATE POLICY vcs_status_deliveries_tenant ON vcs_status_deliveries FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE signal_integrations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS signal_integrations_tenant ON signal_integrations;
CREATE POLICY signal_integrations_tenant ON signal_integrations FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE signal_csv_imports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS signal_csv_imports_tenant ON signal_csv_imports;
CREATE POLICY signal_csv_imports_tenant ON signal_csv_imports FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

-- webhook_events: release_id only (no workspace_id column)
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS webhook_events_tenant ON webhook_events;
CREATE POLICY webhook_events_tenant ON webhook_events FOR ALL TO authenticated
  USING (app_release_in_workspace(release_id)) WITH CHECK (app_release_in_workspace(release_id));

-- outbound_webhook_deliveries: scoped via webhook_id -> outbound_webhooks.workspace_id
ALTER TABLE outbound_webhook_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS outbound_webhook_deliveries_tenant ON outbound_webhook_deliveries;
CREATE POLICY outbound_webhook_deliveries_tenant ON outbound_webhook_deliveries FOR ALL TO authenticated
  USING (webhook_id IN (SELECT id FROM outbound_webhooks WHERE workspace_id = app_workspace_id()))
  WITH CHECK (webhook_id IN (SELECT id FROM outbound_webhooks WHERE workspace_id = app_workspace_id()));
