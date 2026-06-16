import { resolveApiOrigin } from "./apiClient.js";

/**
 * Fetch a public certification record (no auth). Returns null on 404.
 */
export async function fetchPublicCertRecord(workspaceSlug, version) {
  const slug = encodeURIComponent(String(workspaceSlug || "").trim());
  const ver = encodeURIComponent(String(version || "").trim());
  if (!slug || !ver) return null;

  const url = `${resolveApiOrigin()}/api/public/cert/${slug}/${ver}`;
  const res = await fetch(url, { credentials: "omit" });
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = new Error(`Failed to load certification record (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}
