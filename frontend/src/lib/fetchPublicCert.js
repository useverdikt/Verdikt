import { resolveApiOrigin } from "./apiClient.js";

/**
 * Fetch a public certification record (no auth). Returns null on 404.
 */
export async function fetchPublicCertRecord(workspaceSlug, version) {
  const slug = encodeURIComponent(String(workspaceSlug || "").trim());
  const ver = encodeURIComponent(String(version || "").trim());
  if (!slug || !ver) return null;

  const url = `${resolveApiOrigin()}/api/public/cert/${slug}/${ver}`;
  return readPublicCertResponse(await fetch(url, { credentials: "omit" }));
}

export async function fetchPublicCertRecordById(releaseId) {
  const id = encodeURIComponent(String(releaseId || "").trim());
  if (!id) return null;
  const url = `${resolveApiOrigin()}/api/public/cert/id/${id}`;
  return readPublicCertResponse(await fetch(url, { credentials: "omit" }));
}

export async function fetchCertVerification(releaseId) {
  const id = encodeURIComponent(String(releaseId || "").trim());
  if (!id) return null;
  const url = `${resolveApiOrigin()}/api/releases/${id}/cert/verify`;
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) {
    const err = new Error(`Failed to verify certification record (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function readPublicCertResponse(res) {
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = new Error(`Failed to load certification record (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}
