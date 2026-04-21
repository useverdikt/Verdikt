import { apiFetchInit, resolveApiOrigin } from "../../lib/apiClient.js";

export function api(path, opts = {}) {
  const base = resolveApiOrigin();
  const { headers: h, ...rest } = opts;
  return fetch(`${base}${path}`, apiFetchInit({ ...rest, headers: { ...h } }));
}

export function json(path, opts) {
  return api(path, opts).then((r) => r.json());
}
