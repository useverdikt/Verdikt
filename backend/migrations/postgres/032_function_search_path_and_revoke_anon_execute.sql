-- Supabase linter hardening (round 2).
--
-- 1) function_search_path_mutable: verdikt_audit_events_immutable trigger fn
--    had no explicit search_path. Recreate with a locked search_path.
--
-- 2) anon_security_definer_function_executable: the RLS helper functions
--    (app_workspace_id, app_release_in_workspace, app_chain_in_workspace,
--     app_webhook_in_workspace, verdikt_jwt_uid) were callable by the anon
--    role via /rest/v1/rpc/<fn>. None of them are meant to be called as RPCs
--    (no client does — verified). They only need to be invokable by the
--    `authenticated` role, because RLS policy expressions execute as the
--    querying user. Revoke EXECUTE from anon (and PUBLIC defensively) while
--    keeping the grant for authenticated, so tenant policies keep working.
--
-- NOTE (accepted, not fixed here):
--   * authenticated_security_definer_function_executable on the same helpers:
--     intentional — RLS policies run as the authenticated user, so EXECUTE
--     must remain. Supabase documents this as expected for RLS helpers.
--   * rls_policy_always_true on waitlist_requests INSERT: intentional public
--     landing-page form (WITH CHECK (true)); columns are NOT NULL.
--   * auth_leaked_password_protection: Supabase Auth dashboard setting, not
--     controllable via SQL migration.

-- 1) Lock the search_path on the append-only audit trigger function.
DROP FUNCTION IF EXISTS verdikt_audit_events_immutable();

CREATE OR REPLACE FUNCTION verdikt_audit_events_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;

DROP TRIGGER IF EXISTS verdikt_audit_events_no_mutate ON audit_events;
CREATE TRIGGER verdikt_audit_events_no_mutate
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION verdikt_audit_events_immutable();

-- 2) Stop the anon (public) role from directly executing RLS helper functions
--    over PostgREST. Keep EXECUTE for authenticated so RLS policies still work.

REVOKE EXECUTE ON FUNCTION app_workspace_id() FROM anon;
REVOKE EXECUTE ON FUNCTION app_workspace_id() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app_release_in_workspace(text) FROM anon;
REVOKE EXECUTE ON FUNCTION app_release_in_workspace(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app_chain_in_workspace(text) FROM anon;
REVOKE EXECUTE ON FUNCTION app_chain_in_workspace(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app_webhook_in_workspace(text) FROM anon;
REVOKE EXECUTE ON FUNCTION app_webhook_in_workspace(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION verdikt_jwt_uid() FROM anon;
REVOKE EXECUTE ON FUNCTION verdikt_jwt_uid() FROM PUBLIC;

-- Defensively ensure authenticated can still call them (RLS depends on this).
GRANT EXECUTE ON FUNCTION app_workspace_id() TO authenticated;
GRANT EXECUTE ON FUNCTION app_release_in_workspace(text) TO authenticated;
GRANT EXECUTE ON FUNCTION app_chain_in_workspace(text) TO authenticated;
GRANT EXECUTE ON FUNCTION app_webhook_in_workspace(text) TO authenticated;
GRANT EXECUTE ON FUNCTION verdikt_jwt_uid() TO authenticated;
