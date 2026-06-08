import { apiFetchInit, resolveApiOrigin } from "../../lib/apiClient.js";

export function api(path, opts = {}) {
  const base = resolveApiOrigin();
  const { headers: h, ...rest } = opts;
  return fetch(`${base}${path}`, apiFetchInit({ ...rest, headers: { ...h } }));
}

export async function json(path, opts) {
  const r = await api(path, opts);
  let body = null;
  try {
    body = await r.json();
  } catch {
    body = null;
  }
  if (!r.ok) {
    const msg = body?.error || body?.message || `Request failed (${r.status})`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return body;
}
