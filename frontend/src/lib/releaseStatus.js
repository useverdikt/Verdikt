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

/** Ingest is locked only after a certified verdict — UNCERTIFIED releases can still receive signals. */
export function isIngestLocked(status) {
  const s = normalizeReleaseStatus(status);
  return s === UI_RELEASE_STATUS.CERTIFIED || s === UI_RELEASE_STATUS.CERTIFIED_WITH_OVERRIDE;
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
