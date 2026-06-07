-- Enable RLS for workspace-scoped GitHub/inbound webhook config tables.
-- These tables are in public schema and should not be readable via PostgREST without policy.

ALTER TABLE IF EXISTS public.workspace_inbound_webhook_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.github_label_triggers ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.github_app_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.github_app_install_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.github_repo_connections ENABLE ROW LEVEL SECURITY;
