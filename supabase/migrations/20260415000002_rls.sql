-- Row Level Security: tenant isolation by workspace linked to auth.uid().
-- Service role (backend/Edge Functions) bypasses RLS.
-- `authenticated` JWT must have a matching `users.auth_user_id`.

-- Helper: workspace id for the current JWT (null if not linked or not logged in).
CREATE OR REPLACE FUNCTION public.app_workspace_id ()
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $$
  SELECT workspace_id
  FROM public.users
  WHERE auth_user_id = auth.uid()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.app_workspace_id () FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_workspace_id () TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_workspace_id () TO service_role;

CREATE OR REPLACE FUNCTION public.app_release_in_workspace (p_release_id text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.releases r
    WHERE r.id = p_release_id
      AND r.workspace_id = public.app_workspace_id()
  );
$$;

REVOKE ALL ON FUNCTION public.app_release_in_workspace (text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_release_in_workspace (text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_release_in_workspace (text) TO service_role;

CREATE OR REPLACE FUNCTION public.app_chain_in_workspace (p_chain_id text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.env_chains ec
    WHERE ec.id = p_chain_id
      AND ec.workspace_id = public.app_workspace_id()
  );
$$;

REVOKE ALL ON FUNCTION public.app_chain_in_workspace (text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_chain_in_workspace (text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_chain_in_workspace (text) TO service_role;

CREATE OR REPLACE FUNCTION public.app_webhook_in_workspace (p_webhook_id text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.outbound_webhooks w
    WHERE w.id = p_webhook_id
      AND w.workspace_id = public.app_workspace_id()
  );
$$;

REVOKE ALL ON FUNCTION public.app_webhook_in_workspace (text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.app_webhook_in_workspace (text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_webhook_in_workspace (text) TO service_role;

-- ─── users ───────────────────────────────────────────────────────────────────

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_select_own ON public.users
  FOR SELECT TO authenticated
  USING (auth_user_id = auth.uid());

CREATE POLICY users_update_own ON public.users
  FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

-- ─── Workspace-scoped tables (direct workspace_id column) ────────────────────

ALTER TABLE public.thresholds ENABLE ROW LEVEL SECURITY;
CREATE POLICY thresholds_tenant ON public.thresholds FOR ALL TO authenticated
  USING (workspace_id = public.app_workspace_id())
  WITH CHECK (workspace_id = public.app_workspace_id());

ALTER TABLE public.workspace_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY workspace_policies_tenant ON public.workspace_policies FOR ALL TO authenticated
  USING (workspace_id = public.app_workspace_id())
  WITH CHECK (workspace_id = public.app_workspace_id());

ALTER TABLE public.releases ENABLE ROW LEVEL SECURITY;
CREATE POLICY releases_tenant ON public.releases FOR ALL TO authenticated
  USING (workspace_id = public.app_workspace_id())
  WITH CHECK (workspace_id = public.app_workspace_id());

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_events_tenant ON public.audit_events FOR ALL TO authenticated
  USING (workspace_id = public.app_workspace_id())
  WITH CHECK (workspace_id = public.app_workspace_id());

ALTER TABLE public.release_intelligence ENABLE ROW LEVEL SECURITY;
CREATE POLICY release_intelligence_tenant ON public.release_intelligence FOR ALL TO authenticated
  USING (workspace_id = public.app_workspace_id())
  WITH CHECK (workspace_id = public.app_workspace_id());

ALTER TABLE public.release_deltas ENABLE ROW LEVEL SECURITY;
CREATE POLICY release_deltas_tenant ON public.release_deltas FOR ALL TO authenticated
  USING (workspace_id = public.app_workspace_id())
  WITH CHECK (workspace_id = public.app_workspace_id());

ALTER TABLE public.cert_signatures ENABLE ROW LEVEL SECURITY;
CREATE POLICY cert_signatures_tenant ON public.cert_signatures FOR ALL TO authenticated
  USING (workspace_id = public.app_workspace_id())
  WITH CHECK (workspace_id = public.app_workspace_id());

ALTER TABLE public.baseline_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY baseline_policies_tenant ON public.baseline_policies FOR ALL TO authenticated
  USING (workspace_id = public.app_workspace_id())
  WITH CHECK (workspace_id = public.app_workspace_id());

ALTER TABLE public.release_early_warnings ENABLE ROW LEVEL SECURITY;
CREATE POLICY release_early_warnings_tenant ON public.release_early_warnings FOR ALL TO authenticated
  USING (workspace_id = public.app_workspace_id())
  WITH CHECK (workspace_id = public.app_workspace_id());

ALTER TABLE public.outbound_webhooks ENABLE ROW LEVEL SECURITY;
CREATE POLICY outbound_webhooks_tenant ON public.outbound_webhooks FOR ALL TO authenticated
  USING (workspace_id = public.app_workspace_id())
  WITH CHECK (workspace_id = public.app_workspace_id());

ALTER TABLE public.signal_schema ENABLE ROW LEVEL SECURITY;
CREATE POLICY signal_schema_tenant ON public.signal_schema FOR ALL TO authenticated
  USING (workspace_id = public.app_workspace_id())
  WITH CHECK (workspace_id = public.app_workspace_id());

ALTER TABLE public.signal_correlations ENABLE ROW LEVEL SECURITY;
CREATE POLICY signal_correlations_tenant ON public.signal_correlations FOR ALL TO authenticated
  USING (workspace_id = public.app_workspace_id())
  WITH CHECK (workspace_id = public.app_workspace_id());

ALTER TABLE public.failure_mode_classifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY failure_mode_classifications_tenant ON public.failure_mode_classifications FOR ALL TO authenticated
  USING (workspace_id = public.app_workspace_id())
  WITH CHECK (workspace_id = public.app_workspace_id());

ALTER TABLE public.env_chains ENABLE ROW LEVEL SECURITY;
CREATE POLICY env_chains_tenant ON public.env_chains FOR ALL TO authenticated
  USING (workspace_id = public.app_workspace_id())
  WITH CHECK (workspace_id = public.app_workspace_id());

ALTER TABLE public.sse_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY sse_tokens_tenant ON public.sse_tokens FOR ALL TO authenticated
  USING (workspace_id = public.app_workspace_id())
  WITH CHECK (workspace_id = public.app_workspace_id());

ALTER TABLE public.vcs_integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY vcs_integrations_tenant ON public.vcs_integrations FOR ALL TO authenticated
  USING (workspace_id = public.app_workspace_id())
  WITH CHECK (workspace_id = public.app_workspace_id());

ALTER TABLE public.vcs_status_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY vcs_status_deliveries_tenant ON public.vcs_status_deliveries FOR ALL TO authenticated
  USING (workspace_id = public.app_workspace_id())
  WITH CHECK (workspace_id = public.app_workspace_id());

ALTER TABLE public.override_analytics_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY override_analytics_cache_tenant ON public.override_analytics_cache FOR ALL TO authenticated
  USING (workspace_id = public.app_workspace_id())
  WITH CHECK (workspace_id = public.app_workspace_id());

ALTER TABLE public.signal_reliability ENABLE ROW LEVEL SECURITY;
CREATE POLICY signal_reliability_tenant ON public.signal_reliability FOR ALL TO authenticated
  USING (workspace_id = public.app_workspace_id())
  WITH CHECK (workspace_id = public.app_workspace_id());

ALTER TABLE public.production_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY production_observations_tenant ON public.production_observations FOR ALL TO authenticated
  USING (workspace_id = public.app_workspace_id())
  WITH CHECK (workspace_id = public.app_workspace_id());

ALTER TABLE public.outcome_alignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY outcome_alignments_tenant ON public.outcome_alignments FOR ALL TO authenticated
  USING (workspace_id = public.app_workspace_id())
  WITH CHECK (workspace_id = public.app_workspace_id());

ALTER TABLE public.production_adjustment_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY production_adjustment_cache_tenant ON public.production_adjustment_cache FOR ALL TO authenticated
  USING (workspace_id = public.app_workspace_id())
  WITH CHECK (workspace_id = public.app_workspace_id());

ALTER TABLE public.vcs_monitoring_windows ENABLE ROW LEVEL SECURITY;
CREATE POLICY vcs_monitoring_windows_tenant ON public.vcs_monitoring_windows FOR ALL TO authenticated
  USING (workspace_id = public.app_workspace_id())
  WITH CHECK (workspace_id = public.app_workspace_id());

ALTER TABLE public.signal_integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY signal_integrations_tenant ON public.signal_integrations FOR ALL TO authenticated
  USING (workspace_id = public.app_workspace_id())
  WITH CHECK (workspace_id = public.app_workspace_id());

ALTER TABLE public.signal_csv_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY signal_csv_imports_tenant ON public.signal_csv_imports FOR ALL TO authenticated
  USING (workspace_id = public.app_workspace_id())
  WITH CHECK (workspace_id = public.app_workspace_id());

-- ─── Joined / release-keyed tables ───────────────────────────────────────────

ALTER TABLE public.signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY signals_tenant ON public.signals FOR ALL TO authenticated
  USING (public.app_release_in_workspace (release_id))
  WITH CHECK (public.app_release_in_workspace (release_id));

ALTER TABLE public.overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY overrides_tenant ON public.overrides FOR ALL TO authenticated
  USING (public.app_release_in_workspace (release_id))
  WITH CHECK (public.app_release_in_workspace (release_id));

ALTER TABLE public.override_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY override_history_tenant ON public.override_history FOR ALL TO authenticated
  USING (public.app_release_in_workspace (release_id))
  WITH CHECK (public.app_release_in_workspace (release_id));

ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY webhook_events_tenant ON public.webhook_events FOR ALL TO authenticated
  USING (public.app_release_in_workspace (release_id))
  WITH CHECK (public.app_release_in_workspace (release_id));

ALTER TABLE public.env_chain_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY env_chain_links_tenant ON public.env_chain_links FOR ALL TO authenticated
  USING (public.app_chain_in_workspace (chain_id))
  WITH CHECK (public.app_chain_in_workspace (chain_id));

ALTER TABLE public.outbound_webhook_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY outbound_webhook_deliveries_tenant ON public.outbound_webhook_deliveries FOR ALL TO authenticated
  USING (public.app_webhook_in_workspace (webhook_id))
  WITH CHECK (public.app_webhook_in_workspace (webhook_id));

-- ─── password_reset_tokens: app server / Edge Functions use service role ──

ALTER TABLE public.password_reset_tokens ENABLE ROW LEVEL SECURITY;
-- No policies: only service_role bypasses; block direct client access.

-- ─── waitlist: public INSERT (anon + authenticated), no SELECT from client ───

ALTER TABLE public.waitlist_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY waitlist_insert_anon ON public.waitlist_requests
  FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY waitlist_insert_authenticated ON public.waitlist_requests
  FOR INSERT TO authenticated
  WITH CHECK (true);

GRANT INSERT ON public.waitlist_requests TO anon;
GRANT INSERT ON public.waitlist_requests TO authenticated;

-- ─── Grants for identity columns + table DML (RLS still applies) ───────────

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
