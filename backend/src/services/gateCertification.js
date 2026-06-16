"use strict";

const { queryOne } = require("../database");

/**
 * gateCertification.js
 *
 * Symmetric counterpart to gateRemediation. Builds a structured decision log
 * for the *passing* path — answering "why was this release certified?" with
 * the same rigour that remediation answers "why was it blocked?".
 *
 * Attached to check_gate when can_merge === true. Consumed by:
 *   - MCP agents: agent_guidance.certification
 *   - Certification record modal / public badge page
 *   - Outbound webhooks / CI callbacks
 */

async function buildGateCertification({
  release,
  intelligence,
  thresholdMap = {},
  latest = {},
  missingRequiredSignals = []
}) {
  const verdictIntel = intelligence?.verdict || null;
  const regressionContext = verdictIntel?.regression_context || null;
  const regressionHistory = verdictIntel?.regression_history || null;

  // ── Passed signals ────────────────────────────────────────────────────────
  // Build a compact record for every signal that has a configured threshold
  // and a recorded value, ordered by whether it was required for cert.
  const passedSignals = [];

  for (const [signalId, threshold] of Object.entries(thresholdMap)) {
    const value = latest[signalId];
    if (value == null) continue;

    const entry = {
      signal_id: signalId,
      value,
      required_for_certification: threshold.required_for_certification === true ||
        threshold.required_for_certification === 1
    };

    if (threshold.min != null || threshold.max != null) {
      entry.threshold = { min: threshold.min ?? null, max: threshold.max ?? null };
    }

    // Baseline comparison — was there a regression risk and it held steady?
    const hist = regressionHistory?.signals?.find((h) => h.signal_id === signalId);
    if (hist && hist.consecutive_regression_releases === 0 &&
        hist.prior_regression_failures_in_window >= 1) {
      entry.regression_note = {
        prior_failures_in_window: hist.prior_regression_failures_in_window,
        prior_releases_in_window: hist.prior_releases_in_window,
        verdict: "held_steady"
      };
    }

    passedSignals.push(entry);
  }

  // Sort: required signals first, then by signal_id alphabetically
  passedSignals.sort((a, b) => {
    if (a.required_for_certification && !b.required_for_certification) return -1;
    if (!a.required_for_certification && b.required_for_certification) return 1;
    return a.signal_id.localeCompare(b.signal_id);
  });

  // ── Baseline reference ────────────────────────────────────────────────────
  let baseline_reference = null;
  const baselineReleaseId = regressionContext?.baseline_release_id;
  if (baselineReleaseId) {
    const baselineRow = await queryOne(
      "SELECT id, version, created_at, verdict_issued_at FROM releases WHERE id = ?",
      [baselineReleaseId]
    );
    if (baselineRow) {
      baseline_reference = {
        release_id: baselineRow.id,
        version: baselineRow.version,
        certified_at: baselineRow.verdict_issued_at || baselineRow.created_at
      };
    }
  }

  const noPriorBaseline = regressionContext?.no_prior_certified_baseline === true;

  // ── Required signals inventory ────────────────────────────────────────────
  const requiredMet = passedSignals
    .filter((s) => s.required_for_certification)
    .map((s) => s.signal_id);

  // Signals required but not yet ingested (possible when CERTIFIED despite
  // missing non-hard-gate signals or after policy allows it)
  const requiredMissing = (missingRequiredSignals || []).filter(Boolean);

  // ── Summary ───────────────────────────────────────────────────────────────
  const summary = verdictIntel?.summary ||
    (requiredMissing.length > 0
      ? "Certification was issued while required signals were still missing — review before shipping."
      : noPriorBaseline
        ? "Signals meet current thresholds. No prior certified baseline exists yet, so regression checks were skipped — this is normal for the first certified release."
        : passedSignals.length === 0
          ? "Release certified with no signal values recorded."
          : "All required signals met current thresholds. No blocking risk pattern detected.");

  // ── Note ─────────────────────────────────────────────────────────────────
  const note = requiredMissing.length > 0
    ? "Certified with missing signals — policy allowed certification without them. Consider ingest before next release."
    : "This record is permanent. It is the authoritative log of which signals cleared which thresholds at the time of certification.";

  return {
    summary,
    risk_level: verdictIntel?.risk_level || "LOW",
    confidence: typeof verdictIntel?.confidence === "number" ? verdictIntel.confidence : 0.72,
    passed_signals: passedSignals.slice(0, 12),
    required_signals_met: requiredMet,
    required_signals_missing: requiredMissing,
    baseline_reference,
    monitoring_note: Array.isArray(verdictIntel?.recommended_actions) && verdictIntel.recommended_actions.length
      ? verdictIntel.recommended_actions[0]
      : "Ship with normal monitoring and post-release review.",
    note
  };
}

module.exports = { buildGateCertification };
