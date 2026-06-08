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
  return normalizeLegacyUiStatus(backendStatus);
}

/** Accept legacy demo/local statuses during transition. */
export function normalizeLegacyUiStatus(status) {
  const v = String(status || "").toLowerCase();
  if (v === "shipped") return UI_RELEASE_STATUS.CERTIFIED;
  if (v === "blocked" || v === "pending") return UI_RELEASE_STATUS.UNCERTIFIED;
  if (Object.values(UI_RELEASE_STATUS).includes(v)) return v;
  return UI_RELEASE_STATUS.UNCERTIFIED;
}

/** @param {string} uiStatus */
export function uiStatusLabel(uiStatus) {
  const s = normalizeLegacyUiStatus(uiStatus);
  if (s === UI_RELEASE_STATUS.CERTIFIED) return "CERTIFIED";
  if (s === UI_RELEASE_STATUS.UNCERTIFIED) return "UNCERTIFIED";
  if (s === UI_RELEASE_STATUS.CERTIFIED_WITH_OVERRIDE) return "CERTIFIED WITH OVERRIDE";
  if (s === UI_RELEASE_STATUS.COLLECTING) return "COLLECTING";
  return String(uiStatus || "—").toUpperCase();
}

export function isVerdictIssued(uiStatus) {
  const s = normalizeLegacyUiStatus(uiStatus);
  return s !== UI_RELEASE_STATUS.COLLECTING;
}

export function isCertifiedLike(uiStatus) {
  const s = normalizeLegacyUiStatus(uiStatus);
  return s === UI_RELEASE_STATUS.CERTIFIED || s === UI_RELEASE_STATUS.CERTIFIED_WITH_OVERRIDE;
}
