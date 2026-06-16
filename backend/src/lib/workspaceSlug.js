"use strict";

const RESERVED_SLUGS = new Set([
  "workspace",
  "api",
  "admin",
  "public",
  "badge",
  "cert",
  "releases",
  "settings",
  "login",
  "app"
]);

function normalizeWorkspaceSlug(raw) {
  return String(raw || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

function validateWorkspaceSlug(raw) {
  const slug = normalizeWorkspaceSlug(raw);
  if (!slug || slug.length < 2 || slug.length > 64) {
    return { ok: false, error: "slug must be 2–64 characters (letters, numbers, hyphens)" };
  }
  if (RESERVED_SLUGS.has(slug)) {
    return { ok: false, error: `slug "${slug}" is reserved` };
  }
  return { ok: true, slug };
}

module.exports = { normalizeWorkspaceSlug, validateWorkspaceSlug, RESERVED_SLUGS };
