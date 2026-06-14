-- Ensure every user has a workspace_members row for their home workspace.
-- Supabase auth signup (verdikt_handle_new_user) historically skipped this insert.

INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
SELECT u.workspace_id, u.id, u.role, u.created_at
FROM users u
WHERE u.workspace_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM workspace_members wm
    WHERE wm.workspace_id = u.workspace_id
      AND wm.user_id = u.id
  )
ON CONFLICT (workspace_id, user_id) DO NOTHING;
