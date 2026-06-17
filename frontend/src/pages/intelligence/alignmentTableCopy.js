/** Copy helpers for Production Alignment table (Intelligence hub). */

export const ALIGNMENT_TABLE_HEADERS = [
  { key: "release", label: "Release" },
  {
    key: "pre_ship",
    label: "Pre-ship recommendation",
    title: "Advisory risk read at verdict time — separate from release status and merge gate"
  },
  { key: "prod_outcome", label: "Prod outcome", title: "Post-deploy classification from production observations" },
  {
    key: "drivers",
    label: "Outcome drivers",
    title: "Signals or rules that drove the prod outcome (incident criteria that fired, or a clean VCS window)"
  },
  { key: "alignment", label: "Alignment", title: "Whether the pre-ship recommendation matched what happened in prod" },
  { key: "incident", label: "Incident" }
];

export const ALIGNMENT_LEGEND =
  "Correct — pre-ship read matched prod. Miss — go-ahead call but prod had issues. Over-block — Verdikt advised hold but prod was healthy. Bypass · healthy — merged without certification; prod was fine.";

const PRE_SHIP_BY_VERDICT = {
  CERTIFIED: {
    label: "Low risk",
    color: "green",
    riskIndicator: false,
    detail: "Proceed with standard monitoring"
  },
  CERTIFIED_WITH_RISK: {
    label: "Cautious proceed",
    color: "amber",
    riskIndicator: true,
    detail: "Passes gate with elevated risk flags"
  },
  UNCERTIFIED: {
    label: "Do not ship",
    color: "red",
    riskIndicator: false,
    detail: "Hold release — signals or thresholds failed"
  },
  UNCERTIFIED_NOISY: {
    label: "Uncertain evidence",
    color: "amber",
    riskIndicator: true,
    detail: "Low-confidence block — noisy or unreliable signals"
  }
};

const ALIGNMENT_BY_KEY = {
  CORRECT: { label: "Correct", color: "#22c87a", icon: "✓", title: "Pre-ship read matched prod outcome" },
  MISS: { label: "Miss", color: "#ef4444", icon: "✗", title: "Go-ahead call but prod degraded or incident" },
  OVER_BLOCK: { label: "Over-block", color: "#f5a623", icon: "⚠", title: "Hold / do-not-ship call but prod was healthy" },
  UNKNOWN: { label: "Unknown", color: "#7a788b", icon: "?", title: "Insufficient data to score alignment" }
};

export function formatPreShipRecommendation(verdict, row = {}) {
  const meta = PRE_SHIP_BY_VERDICT[verdict] || {
    label: verdict || "—",
    color: "dim",
    riskIndicator: false,
    detail: ""
  };
  const parts = [meta.detail];
  if (row.release_status) parts.push(`Release status: ${row.release_status}`);
  if (row.shipped_without_certification) parts.push("Bypassed at merge");
  if (row.environment) parts.push(`Environment: ${row.environment}`);
  return {
    ...meta,
    title: parts.filter(Boolean).join(" · ")
  };
}

export function resolveAlignmentDisplay(alignment, row = {}) {
  const bypassed = row.shipped_without_certification === 1 || row.shipped_without_certification === true;
  if (alignment === "OVER_BLOCK" && bypassed) {
    return {
      label: "Bypass · healthy",
      color: "#e11d48",
      icon: "↷",
      title: "Merged without certification; prod monitoring showed no incident criteria met"
    };
  }
  return ALIGNMENT_BY_KEY[alignment] || ALIGNMENT_BY_KEY.UNKNOWN;
}

export function formatOutcomeDrivers({ outcome_criteria = [], actual_outcome, signal_deltas = {} }) {
  if (outcome_criteria.length > 0) {
    const first = outcome_criteria[0];
    const val = typeof first.value === "number" ? first.value.toFixed(1) : first.value;
    return {
      text: `${first.label}: ${val}`,
      expandable: true,
      detailKind: "criteria"
    };
  }

  const vcsHealthy = signal_deltas.vcs_healthy?.post != null;
  const vcsReverts = signal_deltas.vcs_reverts?.post ?? 0;
  const vcsHotfixes = signal_deltas.vcs_hotfixes?.post ?? 0;
  const vcsIncidents = signal_deltas.vcs_incident_prs?.post ?? 0;
  const hasVcsObservation =
    vcsHealthy || vcsReverts > 0 || vcsHotfixes > 0 || vcsIncidents > 0;

  if (actual_outcome === "HEALTHY" && vcsHealthy && vcsReverts === 0 && vcsHotfixes === 0 && vcsIncidents === 0) {
    return {
      text: "Clean monitoring window — no reverts/hotfixes",
      expandable: true,
      detailKind: "vcs_clean"
    };
  }

  if (actual_outcome === "HEALTHY" && hasVcsObservation) {
    return {
      text: "No incident criteria met",
      expandable: true,
      detailKind: "vcs_summary"
    };
  }

  if (actual_outcome === "HEALTHY") {
    return { text: "No incident criteria met", expandable: false, detailKind: "none" };
  }

  if (actual_outcome === "UNKNOWN") {
    return { text: "Insufficient post-deploy data", expandable: false, detailKind: "none" };
  }

  return { text: "No incident criteria met", expandable: false, detailKind: "none" };
}

/** @deprecated use formatPreShipRecommendation */
export function preShipRecommendationColor(verdict) {
  return formatPreShipRecommendation(verdict).color;
}
