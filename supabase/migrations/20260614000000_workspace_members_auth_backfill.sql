-- Backfill home workspace membership for Supabase-auth users and ensure new signups get a member row.

INSERT INTO public.workspace_members (workspace_id, user_id, role, created_at)
SELECT u.workspace_id, u.id, u.role, u.created_at
FROM public.users u
WHERE u.workspace_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.workspace_members wm
    WHERE wm.workspace_id = u.workspace_id
      AND wm.user_id = u.id
  )
ON CONFLICT (workspace_id, user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.verdikt_handle_new_user ()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $$
DECLARE
  wid text;
  disp_name text;
BEGIN
  IF EXISTS (SELECT 1 FROM public.users u WHERE u.auth_user_id = new.id) THEN
    RETURN new;
  END IF;

  wid := 'ws_' || substring(replace(gen_random_uuid()::text, '-', '') FROM 1 FOR 16);
  disp_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'name'), ''),
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    split_part(coalesce(new.email, 'user@local'), '@', 1)
  );

  INSERT INTO public.users (id, email, password_hash, name, workspace_id, role, created_at, auth_user_id)
  VALUES (
    new.id::text,
    coalesce(new.email, 'unknown@local'),
    NULL,
    disp_name,
    wid,
    'ai_product_lead',
    now(),
    new.id
  );

  INSERT INTO public.workspace_policies (
    workspace_id,
    require_ai_eval,
    ai_missing_policy,
    created_at,
    updated_at,
    collection_timeout_policy
  )
  VALUES (
    wid,
    true,
    'block_uncertified',
    now(),
    now(),
    'block_uncertified'
  );

  INSERT INTO public.workspace_members (workspace_id, user_id, role, created_at)
  VALUES (wid, new.id::text, 'ai_product_lead', now())
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  INSERT INTO public.thresholds (workspace_id, signal_id, min_value, max_value)
  VALUES
    (wid, 'accuracy', 85, NULL),
    (wid, 'safety', 90, NULL),
    (wid, 'tone', 85, NULL),
    (wid, 'hallucination', 90, NULL),
    (wid, 'relevance', 82, NULL),
    (wid, 'accuracy_delta', 5, NULL),
    (wid, 'safety_delta', 5, NULL),
    (wid, 'tone_delta', 5, NULL),
    (wid, 'hallucination_delta', 5, NULL),
    (wid, 'relevance_delta', 5, NULL),
    (wid, 'p95latency', NULL, 300),
    (wid, 'p99latency', NULL, 600);

  RETURN new;
END;
$$;
