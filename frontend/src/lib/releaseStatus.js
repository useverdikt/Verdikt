/**
 * 1:1 mapping between backend release.status and UI release.status.
 * Backend: COLLECTING | CERTIFIED | UNCERTIFIED | CERTIFIED_WITH_OVERRIDE
 */

export const UI_RELEASE_STATUS = {
  COLLECTING: "collecting",
  CERTIFIED: "certified",
  UNCERTIFIED: "uncertified",
  CERTIFIED_WITH_OVERRIDE: "overridden"
};

/** @param {string | null | undefined} backendStatus */
export function mapBackendStatusToUi(backendStatus) {
  const key = String(backendStatus || "").toUpperCase();
  if (UI_RELEASE_STATUS[key]) return UI_RELEASE_STATUS[key];
  return UI_RELEASE_STATUS.UNCERTIFIED;
}

/** Normalize UI or backend release status to canonical UI slug. */
export function normalizeReleaseStatus(status) {
  const lower = String(status || "").toLowerCase();
  if (Object.values(UI_RELEASE_STATUS).includes(lower)) return lower;
  return mapBackendStatusToUi(status);
}

/** Gate ingest locked after certification, or when uncertified and already live in prod. */
export function isIngestLocked(statusOrRelease, environment) {
  const release =
    statusOrRelease && typeof statusOrRelease === "object"
      ? statusOrRelease
      : { status: statusOrRelease, environment };
  const s = normalizeReleaseStatus(release.status);
  if (s === UI_RELEASE_STATUS.CERTIFIED || s === UI_RELEASE_STATUS.CERTIFIED_WITH_OVERRIDE) {
    return true;
  }
  if (s === UI_RELEASE_STATUS.UNCERTIFIED && isProdEnvironment(release.environment)) {
    return true;
  }
  return false;
}

/** Pre-ship override is closed once uncertified code is already live in prod. */
export function canOfferOverride(release) {
  if (!release) return false;
  const s = normalizeReleaseStatus(release.status);
  if (s !== UI_RELEASE_STATUS.UNCERTIFIED) return false;
  if (isProdEnvironment(release.environment)) return false;
  return true;
}

/** @param {string} uiStatus */
export function uiStatusLabel(uiStatus) {
  const s = normalizeReleaseStatus(uiStatus);
  if (s === UI_RELEASE_STATUS.CERTIFIED) return "CERTIFIED";
  if (s === UI_RELEASE_STATUS.UNCERTIFIED) return "UNCERTIFIED";
  if (s === UI_RELEASE_STATUS.CERTIFIED_WITH_OVERRIDE) return "CERTIFIED WITH OVERRIDE";
  if (s === UI_RELEASE_STATUS.COLLECTING) return "COLLECTING";
  return String(uiStatus || "—").toUpperCase();
}

export function isVerdictIssued(uiStatus) {
  const s = normalizeReleaseStatus(uiStatus);
  return s !== UI_RELEASE_STATUS.COLLECTING;
}

export function isCertifiedLike(uiStatus) {
  const s = normalizeReleaseStatus(uiStatus);
  return s === UI_RELEASE_STATUS.CERTIFIED || s === UI_RELEASE_STATUS.CERTIFIED_WITH_OVERRIDE;
}

function isProdEnvironment(env) {
  const s = String(env || "").toLowerCase();
  return s === "prod" || s === "production" || s === "main" || s === "master";
}

/** prod + non-cert-like governance — active incident risk (worse than pre-merge UNCERTIFIED). */
export function isLiveBypassRisk(release) {
  if (!release) return false;
  if (!isProdEnvironment(release.environment)) return false;
  return !isCertifiedLike(release.status);
}

export function shippedWithoutCertificationFlag(release) {
  if (!release) return false;
  return release.shipped_without_certification === true || Number(release.shipped_without_certification) === 1;
}
