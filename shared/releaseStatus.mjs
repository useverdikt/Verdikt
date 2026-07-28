/**
 * Shared release-status helpers — ESM source for frontend + MCP + backend.
 * Import via `@useverdikt/shared/releaseStatus` (see package.json exports).
 */

export const BACKEND_RELEASE_STATUSES = ["COLLECTING", "CERTIFIED", "UNCERTIFIED", "CERTIFIED_WITH_OVERRIDE"];

export const CERT_LIKE = new Set(["CERTIFIED", "CERTIFIED_WITH_OVERRIDE"]);

/** Releases with a final verdict (excludes COLLECTING). */
export const VERDICTED = new Set(["CERTIFIED", "UNCERTIFIED", "CERTIFIED_WITH_OVERRIDE"]);

export const BLOCKED_OR_COLLECTING = new Set(["UNCERTIFIED", "COLLECTING"]);

export function isCertLikeStatus(status) {
  return CERT_LIKE.has(String(status || "").toUpperCase());
}

export function isVerdictedStatus(status) {
  return VERDICTED.has(String(status || "").toUpperCase());
}

export function isBlockedOrCollectingStatus(status) {
  return BLOCKED_OR_COLLECTING.has(String(status || "").toUpperCase());
}

export function isProdEnvironment(env) {
  const s = String(env || "").toLowerCase();
  return s === "prod" || s === "production" || s === "main" || s === "master";
}
