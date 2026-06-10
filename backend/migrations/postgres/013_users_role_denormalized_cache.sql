-- users.role is a denormalized cache for the user's home workspace (users.workspace_id).
-- Authoritative RBAC for workspace access: workspace_members.role
-- Application code must update both via workspaceMembers.syncHomeWorkspaceRoleCache().

COMMENT ON COLUMN users.role IS
  'Denormalized cache of role in home workspace (users.workspace_id). Authoritative RBAC: workspace_members.role.';
