/**
 * Shared authenticated fetch helpers for App, Settings, and any feature that calls the Verdikt API.
 * URL resolution matches {@link getSafeApiBase} (empty string in Vite dev → same-origin `/api/...`).
 */
import { getSafeApiBase } from "./apiBase.js";
import { getCsrfHeader } from "./csrfCookie.js";
import { signOutSupabase } from "../auth/supabaseAuth.js";

const CURRENT_USER_KEY = "vdk3_currentUser";

/** Merge init for `fetch` with `credentials: "include"` and CSRF + optional Bearer header. */
export function apiFetchInit(init = {}) {
  const { headers: hInit, ...rest } = init;
  return {
    ...rest,
    credentials: "include",
    headers: { ...authHeaders(), ...hInit }
  };
}

export function resolveApiOrigin() {
  const b = getSafeApiBase();
  if (b) return b;
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

export function getWorkspaceId() {
  return localStorage.getItem("vdk3_workspace_id") || "ws_demo";
}

export function authHeaders() {
  /** Session JWT is HttpOnly (`vdk_auth` cookie); never send Bearer from localStorage. */
  return { ...getCsrfHeader() };
}

/** Alias — same map as `authHeaders` (legacy name from App.jsx). */
export const authFetchHeaders = authHeaders;

function buildUrl(path) {
  return `${getSafeApiBase()}${path}`;
}

function handleUnauthorized(navigate) {
  void signOutSupabase();
  void fetch(`${getSafeApiBase()}/api/auth/logout`, apiFetchInit({ method: "POST" }));
  localStorage.removeItem(CURRENT_USER_KEY);
  if (typeof navigate === "function") {
    navigate("/login", { replace: true });
  } else {
    window.location.href = "/login";
  }
}

/** Explicit logout redirect (e.g. manual 401 handling before `apiGet`). */
export function onApiUnauthorized(navigate) {
  handleUnauthorized(navigate);
}

async function readErrorMessage(res, path, method) {
  let msg = `${method} ${path} failed (${res.status})`;
  try {
    const j = await res.json();
    if (j && typeof j.error === "string") msg = j.error;
  } catch {
    /* non-JSON body */
  }
  return msg;
}

/**
 * @param {string} path - Absolute path starting with `/api/...`
 * @param {{ navigate?: import('react-router-dom').NavigateFunction }} [options]
 *   When `navigate` is passed, 401 uses SPA navigation; otherwise full page redirect to `/login`.
 */
export async function apiGet(path, options = {}) {
  const { navigate } = options;
  const res = await fetch(buildUrl(path), apiFetchInit());
  if (res.status === 401) handleUnauthorized(navigate);
  if (!res.ok) throw new Error(await readErrorMessage(res, path, "GET"));
  return res.json();
}

/**
 * @param {string} path
 * @param {unknown} [body]
 * @param {{ navigate?: import('react-router-dom').NavigateFunction }} [options]
 */
export async function apiPost(path, body, options = {}) {
  const { navigate } = options;
  const res = await fetch(
    buildUrl(path),
    apiFetchInit({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {})
    })
  );
  if (res.status === 401) handleUnauthorized(navigate);
  if (!res.ok) throw new Error(await readErrorMessage(res, path, "POST"));
  return res.json();
}

/**
 * @param {string} path
 * @param {unknown} [body]
 * @param {{ navigate?: import('react-router-dom').NavigateFunction }} [options]
 */
export async function apiPut(path, body, options = {}) {
  const { navigate } = options;
  const res = await fetch(
    buildUrl(path),
    apiFetchInit({
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {})
    })
  );
  if (res.status === 401) handleUnauthorized(navigate);
  if (!res.ok) throw new Error(await readErrorMessage(res, path, "PUT"));
  return res.json();
}

/**
 * @param {string} path
 * @param {{ navigate?: import('react-router-dom').NavigateFunction }} [options]
 */
export async function apiDelete(path, options = {}) {
  const { navigate } = options;
  const res = await fetch(buildUrl(path), apiFetchInit({ method: "DELETE" }));
  if (res.status === 401) handleUnauthorized(navigate);
  if (!res.ok) throw new Error(await readErrorMessage(res, path, "DELETE"));
  if (res.status === 204) return {};
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return {};
}

/**
 * Multipart POST (e.g. CSV upload). Do not set Content-Type — browser sets boundary.
 * @param {string} path
 * @param {FormData} formData
 * @param {{ navigate?: import('react-router-dom').NavigateFunction }} [options]
 */
export async function apiPostFormData(path, formData, options = {}) {
  const { navigate } = options;
  const res = await fetch(buildUrl(path), apiFetchInit({ method: "POST", body: formData }));
  if (res.status === 401) handleUnauthorized(navigate);
  if (!res.ok) throw new Error(await readErrorMessage(res, path, "POST"));
  return res.json();
}
