-- Post-baseline workspace tables + GitHub integration RLS policies.

ALTER TABLE workspace_api_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_api_keys_tenant ON workspace_api_keys;
CREATE POLICY workspace_api_keys_tenant ON workspace_api_keys FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE escalation_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS escalation_requests_tenant ON escalation_requests;
CREATE POLICY escalation_requests_tenant ON escalation_requests FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_members_tenant ON workspace_members;
CREATE POLICY workspace_members_tenant ON workspace_members FOR ALL TO authenticated
  USING (
    workspace_id = app_workspace_id()
    OR user_id IN (SELECT id FROM users WHERE auth_user_id = verdikt_jwt_uid())
  )
  WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE workspace_invites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_invites_tenant ON workspace_invites;
CREATE POLICY workspace_invites_tenant ON workspace_invites FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE agent_sessions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_sessions_tenant ON agent_sessions;
CREATE POLICY agent_sessions_tenant ON agent_sessions FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE workspace_signal_definitions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_signal_definitions_tenant ON workspace_signal_definitions;
CREATE POLICY workspace_signal_definitions_tenant ON workspace_signal_definitions FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE integration_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS integration_requests_tenant ON integration_requests;
CREATE POLICY integration_requests_tenant ON integration_requests FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE signal_library ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS signal_library_read ON signal_library;
CREATE POLICY signal_library_read ON signal_library FOR SELECT TO authenticated USING (true);

ALTER TABLE connector_signal_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS connector_signal_map_read ON connector_signal_map;
CREATE POLICY connector_signal_map_read ON connector_signal_map FOR SELECT TO authenticated USING (true);

-- GitHub tables (005 enabled RLS without policies)
ALTER TABLE workspace_inbound_webhook_secrets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_inbound_webhook_secrets_tenant ON workspace_inbound_webhook_secrets;
CREATE POLICY workspace_inbound_webhook_secrets_tenant ON workspace_inbound_webhook_secrets FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE github_label_triggers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS github_label_triggers_tenant ON github_label_triggers;
CREATE POLICY github_label_triggers_tenant ON github_label_triggers FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE github_app_installations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS github_app_installations_tenant ON github_app_installations;
CREATE POLICY github_app_installations_tenant ON github_app_installations FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE github_app_install_states ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS github_app_install_states_tenant ON github_app_install_states;
CREATE POLICY github_app_install_states_tenant ON github_app_install_states FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE github_repo_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS github_repo_connections_tenant ON github_repo_connections;
CREATE POLICY github_repo_connections_tenant ON github_repo_connections FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
