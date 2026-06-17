/** Copy helpers for Production Alignment table (Intelligence hub). */

export const ALIGNMENT_TABLE_HEADERS = [
  { key: "release", label: "Release" },
  {
    key: "pre_ship",
    label: "Pre-ship rec.",
    title: "Pre-ship recommendation from Verdikt at verdict time (advisory — not the merge gate status)"
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
  "Correct — pre-ship call matched prod. Miss — certified or low-risk call but prod degraded/incident. Over-block — blocked or UNCERTIFIED recommendation but prod was healthy.";

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

export function preShipRecommendationColor(verdict) {
  if (!verdict) return "dim";
  if (verdict.includes("UNCERTIFIED")) return "red";
  if (verdict === "CERTIFIED_WITH_RISK") return "amber";
  return "green";
}
