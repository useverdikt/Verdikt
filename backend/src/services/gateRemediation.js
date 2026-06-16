"use strict";

const { queryOne } = require("../database");

/**
 * Structured diagnostic context for agents and humans when the gate blocks.
 * Built from existing verdict intelligence + live signal/threshold state.
 */
async function buildGateRemediation({
  release,
  intelligence,
  failedSignals = [],
  thresholdMap = {},
  latest = {},
  missingRequiredSignals = []
}) {
  const verdictIntel = intelligence?.verdict || null;
  const regressionHistory = verdictIntel?.regression_history || null;
  const regressionContext = verdictIntel?.regression_context || null;

  const failures = [];
  for (const f of failedSignals) {
    const signalId = f?.signal_id;
    if (!signalId || signalId === "release") continue;

    const threshold = thresholdMap[signalId] || {};
    const hist = regressionHistory?.signals?.find((h) => h.signal_id === signalId);
    const entry = {
      signal_id: signalId,
      value: f.value ?? latest[signalId] ?? null,
      failure_kind: f.failure_kind || null,
      rule: f.rule || null
    };

    if (threshold.min != null || threshold.max != null) {
      entry.threshold = { min: threshold.min ?? null, max: threshold.max ?? null };
    }
    if (f.baseline_value != null && Number.isFinite(Number(f.baseline_value))) {
      entry.baseline_value = Number(f.baseline_value);
    }
    if (f.drop_amount != null && Number.isFinite(Number(f.drop_amount))) {
      entry.drop_amount = Number(f.drop_amount);
    }
    if (hist && hist.consecutive_regression_releases >= 1) {
      entry.regression_streak = {
        consecutive_releases: hist.consecutive_regression_releases,
        prior_failures_in_window: hist.prior_regression_failures_in_window,
        prior_releases_in_window: hist.prior_releases_in_window
      };
    }
    failures.push(entry);
  }

  let last_passing_baseline = null;
  const baselineReleaseId = regressionContext?.baseline_release_id;
  if (baselineReleaseId) {
    const baselineRow = await queryOne(
      "SELECT id, version, created_at, verdict_issued_at FROM releases WHERE id = ?",
      [baselineReleaseId]
    );
    if (baselineRow) {
      const refFailure = failures.find((x) => x.baseline_value != null) || null;
      last_passing_baseline = {
        release_id: baselineRow.id,
        version: baselineRow.version,
        reference_signal_value: refFailure?.baseline_value ?? null,
        reference_signal_id: refFailure?.signal_id ?? null,
        certified_at: baselineRow.verdict_issued_at || baselineRow.created_at
      };
    }
  }

  const missing = (missingRequiredSignals || []).filter(Boolean);
  const hasContent =
    failures.length > 0 ||
    missing.length > 0 ||
    (verdictIntel?.summary && String(verdictIntel.summary).trim());

  if (!hasContent) return null;

  return {
    summary: verdictIntel?.summary || null,
    suggested_actions: Array.isArray(verdictIntel?.recommended_actions)
      ? verdictIntel.recommended_actions.slice(0, 5)
      : [],
    failures,
    missing_required_signals: missing,
    last_passing_baseline,
    regression_context: regressionContext,
    risk_level: verdictIntel?.risk_level || null,
    note:
      "Diagnostics use this workspace's certified release history and configured thresholds. Guidance improves as more releases complete the cert loop."
  };
}

module.exports = { buildGateRemediation };
