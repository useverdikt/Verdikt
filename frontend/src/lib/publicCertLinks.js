/**
 * Public certification record URLs. Slug/version links 404 when the workspace
 * slug was never saved; release-id permalinks stay stable.
 */

export function normalizeWorkspaceSlug(raw) {
  const slug = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug;
}

/** True only when a slug was actually stored — not the "workspace" fallback. */
export function readConfiguredWorkspaceSlug(storage = localStorage) {
  const raw = storage?.getItem?.("vdk3_workspace_slug");
  if (raw == null || !String(raw).trim()) {
    return { slug: null, configured: false };
  }
  const slug = normalizeWorkspaceSlug(raw);
  if (!slug) return { slug: null, configured: false };
  return { slug, configured: true };
}

export function publicCertPermalinkPath(releaseId) {
  const id = String(releaseId || "").trim();
  if (!id) return null;
  return `/cert/id/${encodeURIComponent(id)}`;
}

export function publicCertSlugPath(slug, version) {
  const cleaned = normalizeWorkspaceSlug(slug);
  const ver = String(version || "").trim();
  if (!cleaned || !ver) return null;
  return `/cert/${cleaned}/${encodeURIComponent(ver)}`;
}

export function hmacSignatureChipLabel(algorithm) {
  const algo = String(algorithm || "hmac-sha256").trim() || "hmac-sha256";
  return `signed · ${algo}`;
}

export const HMAC_SIGNATURE_TOOLTIP =
  "Server-side HMAC. Verification checks Verdikt's stored record; it is not a third-party signature.";
