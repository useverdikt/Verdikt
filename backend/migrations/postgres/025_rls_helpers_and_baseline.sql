-- RLS helpers + tenant policies. Backend connects as table owner (bypasses RLS).
-- Does NOT create auth.uid() — Supabase/Railway reserve the auth schema.

CREATE OR REPLACE FUNCTION verdikt_jwt_uid()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid text;
BEGIN
  IF to_regnamespace('auth') IS NOT NULL THEN
    BEGIN
      EXECUTE 'SELECT auth.uid()::text' INTO uid;
      IF uid IS NOT NULL AND uid <> '' THEN
        RETURN uid;
      END IF;
    EXCEPTION
      WHEN insufficient_privilege OR undefined_function THEN
        NULL;
    END;
  END IF;
  RETURN NULLIF(current_setting('request.jwt.claim.sub', true), '');
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role;
  END IF;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'verdikt: skipping RLS role creation (insufficient privileges)';
END $$;

CREATE OR REPLACE FUNCTION app_workspace_id()
  RETURNS text
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $$
  SELECT workspace_id
  FROM users
  WHERE auth_user_id = verdikt_jwt_uid()
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION app_release_in_workspace(p_release_id text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $$
  SELECT EXISTS (
    SELECT 1 FROM releases r
    WHERE r.id = p_release_id AND r.workspace_id = app_workspace_id()
  );
$$;

CREATE OR REPLACE FUNCTION app_chain_in_workspace(p_chain_id text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $$
  SELECT EXISTS (
    SELECT 1 FROM env_chains ec
    WHERE ec.id = p_chain_id AND ec.workspace_id = app_workspace_id()
  );
$$;

CREATE OR REPLACE FUNCTION app_webhook_in_workspace(p_webhook_id text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
  AS $$
  SELECT EXISTS (
    SELECT 1 FROM outbound_webhooks w
    WHERE w.id = p_webhook_id AND w.workspace_id = app_workspace_id()
  );
$$;

-- users
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_select_own ON users;
CREATE POLICY users_select_own ON users FOR SELECT TO authenticated
  USING (auth_user_id = verdikt_jwt_uid());
DROP POLICY IF EXISTS users_update_own ON users;
CREATE POLICY users_update_own ON users FOR UPDATE TO authenticated
  USING (auth_user_id = verdikt_jwt_uid()) WITH CHECK (auth_user_id = verdikt_jwt_uid());

-- workspace-scoped tables
ALTER TABLE thresholds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS thresholds_tenant ON thresholds;
CREATE POLICY thresholds_tenant ON thresholds FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE workspace_policies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workspace_policies_tenant ON workspace_policies;
CREATE POLICY workspace_policies_tenant ON workspace_policies FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE releases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS releases_tenant ON releases;
CREATE POLICY releases_tenant ON releases FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_events_tenant ON audit_events;
CREATE POLICY audit_events_tenant ON audit_events FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE release_intelligence ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS release_intelligence_tenant ON release_intelligence;
CREATE POLICY release_intelligence_tenant ON release_intelligence FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE production_observations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS production_observations_tenant ON production_observations;
CREATE POLICY production_observations_tenant ON production_observations FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE outcome_alignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS outcome_alignments_tenant ON outcome_alignments;
CREATE POLICY outcome_alignments_tenant ON outcome_alignments FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

ALTER TABLE threshold_suggestion_dismissals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS threshold_dismissals_tenant ON threshold_suggestion_dismissals;
CREATE POLICY threshold_dismissals_tenant ON threshold_suggestion_dismissals FOR ALL TO authenticated
  USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

-- release-keyed tables
ALTER TABLE signals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS signals_tenant ON signals;
CREATE POLICY signals_tenant ON signals FOR ALL TO authenticated
  USING (app_release_in_workspace(release_id)) WITH CHECK (app_release_in_workspace(release_id));

ALTER TABLE overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS overrides_tenant ON overrides;
CREATE POLICY overrides_tenant ON overrides FOR ALL TO authenticated
  USING (app_release_in_workspace(release_id)) WITH CHECK (app_release_in_workspace(release_id));

-- password_reset_tokens: service role only
ALTER TABLE password_reset_tokens ENABLE ROW LEVEL SECURITY;

-- waitlist public insert
ALTER TABLE waitlist_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS waitlist_insert_anon ON waitlist_requests;
CREATE POLICY waitlist_insert_anon ON waitlist_requests FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS waitlist_insert_authenticated ON waitlist_requests;
CREATE POLICY waitlist_insert_authenticated ON waitlist_requests FOR INSERT TO authenticated WITH CHECK (true);

DO $$
BEGIN
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'verdikt: skipping authenticated grants (insufficient privileges)';
END $$;
