-- Enable RLS for workspace-scoped integration tables that live in public schema.
-- This aligns with Supabase/PostgREST security checks for exposed schemas.

ALTER TABLE IF EXISTS workspace_inbound_webhook_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS github_label_triggers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS github_app_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS github_app_install_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS github_repo_connections ENABLE ROW LEVEL SECURITY;
