/**
 * Confidence band + bar fill for release history (shared with tests).
 * @param {string} status — release.status
 * @param {number|undefined} confidencePct — intelligence.verdict.confidence_pct when present
 */
export function confMeta(status, confidencePct) {
  const pct = Math.max(
    0,
    Math.min(
      100,
      Number.isFinite(confidencePct)
        ? confidencePct
        : status === "blocked"
          ? 41
          : status === "overridden"
            ? 68
            : status === "shipped"
              ? 91
              : 0
    )
  );
  if (status === "collecting" || pct === 0) {
    return { pct: 0, band: "awaiting signals", fill: "" };
  }
  if (pct >= 75) return { pct, band: "HIGH", fill: "hi" };
  if (pct >= 55) return { pct, band: "MEDIUM", fill: "me" };
  return { pct, band: "LOW", fill: "lo" };
}
