/** JWT and related keys (must stay aligned with App.jsx and login flows). */
export const AUTH_TOKEN_KEY = "vdk3_auth_token";

const CURRENT_USER_KEY = "vdk3_currentUser";

export function getStoredJwt() {
  /** Legacy: JWT lives in HttpOnly cookie only; never in localStorage. */
  return null;
}

export function isAuthenticated() {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(CURRENT_USER_KEY) != null;
}

/** Clears JWT and cached user (same keys as `apiClient` 401 handling). */
export function clearAuthSession() {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(CURRENT_USER_KEY);
}
