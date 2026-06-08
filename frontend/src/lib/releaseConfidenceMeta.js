import { normalizeLegacyUiStatus, UI_RELEASE_STATUS } from "./releaseStatus.js";

/**
 * Confidence band + bar fill for release history (shared with tests).
 * @param {string} status — release.status
 * @param {number|undefined} confidencePct — intelligence.verdict.confidence_pct when present
 */
export function confMeta(status, confidencePct) {
  const s = normalizeLegacyUiStatus(status);
  const pct = Math.max(
    0,
    Math.min(
      100,
      Number.isFinite(confidencePct)
        ? confidencePct
        : s === UI_RELEASE_STATUS.UNCERTIFIED
          ? 41
          : s === UI_RELEASE_STATUS.CERTIFIED_WITH_OVERRIDE
            ? 68
            : s === UI_RELEASE_STATUS.CERTIFIED
              ? 91
              : 0
    )
  );
  if (s === UI_RELEASE_STATUS.COLLECTING || pct === 0) {
    return { pct: 0, band: "awaiting signals", fill: "" };
  }
  if (pct >= 75) return { pct, band: "HIGH", fill: "hi" };
  if (pct >= 55) return { pct, band: "MEDIUM", fill: "me" };
  return { pct, band: "LOW", fill: "lo" };
}
