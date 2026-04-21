/**
 * Store user profile for the SPA. Session JWT is HttpOnly (`vdk_auth` cookie); do not persist tokens in localStorage.
 */
export function persistAuthSession({ user }) {
  if (!user || typeof user.workspace_id !== "string") {
    throw new Error("Invalid auth payload");
  }
  const prevWorkspaceId = localStorage.getItem("vdk3_workspace_id");
  if (prevWorkspaceId && prevWorkspaceId !== user.workspace_id) {
    // Prevent cross-workspace/demo state leakage after account switch.
    localStorage.removeItem("vdk3_releases");
    localStorage.removeItem("vdk3_audit");
    localStorage.removeItem("vdk3_infra");
    localStorage.removeItem("vdk3_project");
  }
  try {
    localStorage.removeItem("vdk3_auth_token");
  } catch {
    /* ignore */
  }
  localStorage.setItem("vdk3_workspace_id", user.workspace_id);
  const snapshot = {
    name: user.name,
    email: user.email,
    role: user.role
  };
  if (user.id != null) snapshot.id = user.id;
  localStorage.setItem("vdk3_currentUser", JSON.stringify(snapshot));
}
