import { normalizeLegacyUiStatus, UI_RELEASE_STATUS } from "./releaseStatus.js";

/**
 * Confidence band + bar fill for release history (shared with tests).
 * Always returns the same display shape: displayPct + band + track fill.
 * @param {string} status — release.status
 * @param {number|undefined} confidencePct — recommendation.confidence_score or legacy verdict.confidence_pct
 * @param {{ receivedSignalCount?: number }} [opts]
 */
export function confMeta(status, confidencePct, opts = {}) {
  const s = normalizeLegacyUiStatus(status);
  const received = opts.receivedSignalCount;

  if (s === UI_RELEASE_STATUS.COLLECTING) {
    return { pct: 0, displayPct: "—", band: "AWAITING", fill: "" };
  }
  if (
    typeof received === "number" &&
    received === 0 &&
    (s === UI_RELEASE_STATUS.CERTIFIED || s === UI_RELEASE_STATUS.CERTIFIED_WITH_OVERRIDE)
  ) {
    return { pct: 0, displayPct: "—", band: "NO SIGNALS", fill: "lo" };
  }
  if (!Number.isFinite(confidencePct)) {
    return { pct: 0, displayPct: "—", band: "PENDING", fill: "" };
  }

  const pct = Math.max(0, Math.min(100, confidencePct));
  if (pct >= 75) return { pct, displayPct: `${pct}%`, band: "HIGH", fill: "hi" };
  if (pct >= 55) return { pct, displayPct: `${pct}%`, band: "MEDIUM", fill: "me" };
  return { pct, displayPct: `${pct}%`, band: "LOW", fill: "lo" };
}
