-- Link application `users` rows to Supabase Auth (`auth.users`).
-- After signup/migration, set `users.auth_user_id = auth.uid()` for that row.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS auth_user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_auth_user_id
  ON public.users (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

COMMENT ON COLUMN public.users.auth_user_id IS 'Supabase Auth user id; used by RLS policies.';
