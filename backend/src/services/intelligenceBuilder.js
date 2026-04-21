"use strict";

/**
 * intelligenceBuilder.js — deterministic verdict intelligence + release_intelligence persistence.
 */

const crypto = require("crypto");
const { queryOne, queryAll, run } = require("../database");
const { nowIso } = require("../lib/time");

const INTEL_SIGNAL_LABELS = {
  accuracy: "Accuracy",
  relevance: "Relevance",
  safety: "Safety",
  tone: "Tone",
  hallucination: "Hallucination"
};

function intelSignalLabel(signalId) {
  return INTEL_SIGNAL_LABELS[signalId] || String(signalId);
}

function intelFormatPct(v) {
  if (v == null || !Number.isFinite(Number(v))) return "?";
  return `${Math.round(Number(v))}%`;
}

function deltaRowPassedIntel(row) {
  return row && (row.passed === 1 || row.passed === true);
}

async function getReleaseDeltaRowForIntel(releaseId, signalId) {
  return queryOne(
    `SELECT passed, baseline_value, drop_amount, baseline_release_id, current_value, max_allowed_drop
     FROM release_deltas WHERE release_id = ? AND signal_id = ?`,
    [releaseId, signalId]
  );
}

async function listPriorReleaseMetasForIntel(workspaceId, releaseType, currentReleaseId, limit) {
  const cur = await queryOne("SELECT created_at FROM releases WHERE id = ?", [currentReleaseId]);
  if (!cur?.created_at) return [];
  return queryAll(
    `SELECT id, version, created_at FROM releases
     WHERE workspace_id = ? AND release_type = ? AND id != ?
     AND created_at::timestamptz < ?::timestamptz
     ORDER BY created_at::timestamptz DESC
     LIMIT ?`,
    [workspaceId, releaseType, currentReleaseId, cur.created_at, limit]
  );
}

function ordinalWordConsecutive(n) {
  const words = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];
  if (n >= 2 && n < words.length) return words[n];
  if (n >= 2) return `${n}th`;
  return String(n);
}

async function computeRegressionHistoryInsights(workspaceId, currentReleaseId, releaseType, regressionSignalIds) {
  const unique = [...new Set((regressionSignalIds || []).filter(Boolean))];
  if (!unique.length) return null;

  const priorPool = await listPriorReleaseMetasForIntel(workspaceId, releaseType, currentReleaseId, 12);
  const windowSize = 4;
  const windowSlice = priorPool.slice(0, windowSize);

  const signals = [];
  for (const signalId of unique) {
    const cur = await getReleaseDeltaRowForIntel(currentReleaseId, signalId);
    const hasComparableBaseline = cur && cur.baseline_value != null && Number.isFinite(Number(cur.baseline_value));
    const curFailed = cur && hasComparableBaseline && !deltaRowPassedIntel(cur);

    let consecutive = 0;
    if (curFailed) {
      consecutive = 1;
      for (const p of priorPool) {
        const d = await getReleaseDeltaRowForIntel(p.id, signalId);
        if (!d) break;
        if (d.baseline_value == null || !Number.isFinite(Number(d.baseline_value))) break;
        if (!deltaRowPassedIntel(d)) consecutive++;
        else break;
      }
    }

    let priorFailuresInWindow = 0;
    for (const p of windowSlice) {
      const d = await getReleaseDeltaRowForIntel(p.id, signalId);
      if (d && d.baseline_value != null && Number.isFinite(Number(d.baseline_value)) && !deltaRowPassedIntel(d)) {
        priorFailuresInWindow++;
      }
    }

    signals.push({
      signal_id: signalId,
      consecutive_regression_releases: consecutive,
      prior_releases_in_window: windowSlice.length,
      prior_regression_failures_in_window: priorFailuresInWindow
    });
  }

  return { prior_window_size: windowSize, signals };
}

async function buildDeterministicVerdictIntelligence({
  release,
  failedSignals,
  missingRequiredSignals,
  nextStatus,
  deltaContext,
  regressionHistory = null
}) {
  const failedIds = failedSignals.map((s) => s.signal_id).filter(Boolean);
  const regressionFails = failedSignals.filter(
    (s) => s.failure_kind === "regression" || (s.rule && String(s.rule).startsWith("regression:"))
  );
  const regressionIds = regressionFails.map((s) => s.signal_id).filter(Boolean);
  const hasRegressionFail = regressionIds.length > 0;
  const hasSafetyFail = failedIds.includes("safety");
  const hasHallucinationFail = failedIds.includes("hallucination");
  const hasLatencyFail = failedIds.includes("p95latency") || failedIds.includes("p99latency");
  const severity =
    hasSafetyFail || hasRegressionFail ? "HIGH" : failedIds.length >= 3 ? "HIGH" : failedIds.length >= 1 ? "MEDIUM" : "LOW";

  const noPriorBaseline = !!(deltaContext && deltaContext.no_prior_certified_baseline);
  const baselineNote =
    "No prior certified baseline to compare against yet — regression-from-baseline checks were skipped, and only absolute quality thresholds applied. That's normal while you're still establishing your certification history.";

  const regressionInsightSentences = [];
  if (hasRegressionFail && regressionHistory?.signals?.length && !noPriorBaseline) {
    for (const rf of regressionFails) {
      const hist = regressionHistory.signals.find((h) => h.signal_id === rf.signal_id);
      const lab = intelSignalLabel(rf.signal_id);
      const bv = Number(rf.baseline_value);
      const cv = Number(rf.value);
      let relStr = "a measurable";
      if (bv && Number.isFinite(bv) && Number.isFinite(cv)) {
        relStr = `${(((bv - cv) / bv) * 100).toFixed(0)}%`;
      } else if (rf.drop_amount != null && Number.isFinite(Number(rf.drop_amount))) {
        relStr = `${Number(rf.drop_amount).toFixed(1)} points`;
      }
      regressionInsightSentences.push(
        `This release shows a ~${relStr} regression in ${lab} compared to the last certified release (${intelFormatPct(bv)} → ${intelFormatPct(cv)}).`
      );
      if (hist && hist.consecutive_regression_releases >= 2) {
        regressionInsightSentences.push(
          `This is the ${ordinalWordConsecutive(hist.consecutive_regression_releases)} consecutive release with regression on ${lab}.`
        );
      }
      if (hist && hist.prior_releases_in_window >= 3 && hist.prior_regression_failures_in_window >= 2) {
        regressionInsightSentences.push(
          `High risk: ${lab} has regressed on ${hist.prior_regression_failures_in_window} of the last ${hist.prior_releases_in_window} prior releases — review prompt or model changes.`
        );
      }
    }
  }

  let summary =
    nextStatus === "CERTIFIED"
      ? "Signals meet current thresholds. No blocking risk pattern detected in this deterministic assessment."
      : hasRegressionFail
        ? regressionInsightSentences.length
          ? `${regressionInsightSentences.join(" ")} Review eval deltas and mitigation before shipping or override.`
          : `AI quality regressed vs the prior certified baseline on: ${regressionIds.join(", ")}. Compare eval runs and model changes before shipping.`
        : hasSafetyFail
          ? "Safety is below threshold. Treat this as a high-risk release until mitigations are verified."
          : hasHallucinationFail
            ? "Groundedness is below threshold. Risk of factual error is elevated."
            : hasLatencyFail
              ? "Latency thresholds are exceeded. User-facing performance risk is elevated."
              : "One or more thresholds are not met. Review failures before shipping.";

  if (noPriorBaseline) {
    summary = `${baselineNote} ${summary}`;
  }

  const recommendedActions = [];
  if (hasRegressionFail) {
    recommendedActions.push(
      "Compare this release's eval scores to the last certified baseline; confirm whether the drop is acceptable or roll back."
    );
  }
  if (hasRegressionFail && regressionHistory?.signals?.some((s) => s.consecutive_regression_releases >= 2)) {
    recommendedActions.push(
      "Recommend accepting override only if a corrective model or prompt patch is scheduled within 72 hours with a named owner."
    );
  }
  if (
    hasRegressionFail &&
    regressionHistory?.signals?.some((s) => s.prior_releases_in_window >= 3 && s.prior_regression_failures_in_window >= 3)
  ) {
    recommendedActions.push(
      "Repeated regressions on the same signal across recent releases — review prompts, eval harness, or data drift before another ship."
    );
  }
  if (hasSafetyFail) recommendedActions.push("Run targeted safety/red-team eval before override.");
  if (hasHallucinationFail) recommendedActions.push("Run groundedness checks on high-risk prompts and retrieval paths.");
  if (hasLatencyFail) recommendedActions.push("Validate p95/p99 improvements with canary and load replay.");
  if (missingRequiredSignals.length) recommendedActions.push("Ingest missing required signals before final decision.");
  if (!recommendedActions.length && nextStatus === "CERTIFIED") {
    recommendedActions.push("Ship with normal monitoring and post-release review.");
  }

  const prevRows = await queryAll(
    `SELECT id, version, status, release_type, created_at
     FROM releases
     WHERE workspace_id = ? AND release_type = ? AND id != ?
     ORDER BY created_at::timestamptz DESC
     LIMIT 5`,
    [release.workspace_id, release.release_type, release.id]
  );
  const prev = prevRows.map((r) => ({ id: r.id, version: r.version, status: r.status, created_at: r.created_at }));

  return {
    source: "deterministic_assistive_v1",
    model: "deterministic_assistive_v1",
    prompt_version: "deterministic_v1",
    generated_at: nowIso(),
    risk_level: severity,
    confidence: nextStatus === "CERTIFIED" ? 0.72 : severity === "HIGH" ? 0.84 : 0.76,
    summary,
    likely_failure_modes:
      nextStatus === "CERTIFIED"
        ? []
        : failedSignals.map((s) =>
            s.failure_kind === "regression" || (s.rule && String(s.rule).startsWith("regression:"))
              ? `regression:${s.signal_id}`
              : `threshold_miss:${s.signal_id}`
          ),
    regression_failures: regressionFails.map((s) => ({
      signal_id: s.signal_id,
      baseline_value: s.baseline_value,
      drop_amount: s.drop_amount,
      max_allowed_drop: s.max_allowed_drop
    })),
    recommended_actions: recommendedActions,
    regression_context: deltaContext
      ? {
          no_prior_certified_baseline: noPriorBaseline,
          baseline_release_id: deltaContext.baseline_release_id ?? null
        }
      : null,
    regression_history: regressionHistory || null,
    precedent: { same_release_type_recent: prev }
  };
}

function buildIntelligenceTrace({ releaseId, workspaceId, releaseType, output }) {
  const context = {
    release_id: releaseId,
    workspace_id: workspaceId,
    release_type: releaseType,
    output_keys: Object.keys(output || {})
  };
  const inputContextHash = crypto.createHash("sha256").update(JSON.stringify(context)).digest("hex");
  return {
    model: "deterministic_assistive_v1",
    prompt_version: "deterministic_v1",
    input_context_hash: inputContextHash
  };
}

async function upsertReleaseIntelligence(releaseId, workspaceId, patch = {}) {
  const row = await queryOne(
    "SELECT verdict_json, override_json, trace_json, decision_json, outcome_json, created_at FROM release_intelligence WHERE release_id = ?",
    [releaseId]
  );
  const createdAt = row?.created_at || nowIso();
  const verdictJson = patch.verdict !== undefined ? JSON.stringify(patch.verdict) : row?.verdict_json || null;
  const overrideJson = patch.override !== undefined ? JSON.stringify(patch.override) : row?.override_json || null;
  const traceJson = patch.trace !== undefined ? JSON.stringify(patch.trace) : row?.trace_json || null;
  const decisionJson = patch.decision !== undefined ? JSON.stringify(patch.decision) : row?.decision_json || null;
  const outcomeJson = patch.outcome !== undefined ? JSON.stringify(patch.outcome) : row?.outcome_json || null;
  await run(
    `INSERT INTO release_intelligence (release_id, workspace_id, verdict_json, override_json, trace_json, decision_json, outcome_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(release_id) DO UPDATE SET
       workspace_id = excluded.workspace_id,
       verdict_json = excluded.verdict_json,
       override_json = excluded.override_json,
       trace_json = excluded.trace_json,
       decision_json = excluded.decision_json,
       outcome_json = excluded.outcome_json,
       updated_at = excluded.updated_at`,
    [releaseId, workspaceId, verdictJson, overrideJson, traceJson, decisionJson, outcomeJson, createdAt, nowIso()]
  );
}

async function getReleaseIntelligence(releaseId) {
  const row = await queryOne(
    "SELECT verdict_json, override_json, trace_json, decision_json, outcome_json, created_at, updated_at FROM release_intelligence WHERE release_id = ?",
    [releaseId]
  );
  if (!row) return null;
  return {
    verdict: row.verdict_json ? JSON.parse(row.verdict_json) : null,
    override: row.override_json ? JSON.parse(row.override_json) : null,
    trace: row.trace_json ? JSON.parse(row.trace_json) : null,
    decision: row.decision_json ? JSON.parse(row.decision_json) : null,
    outcome: row.outcome_json ? JSON.parse(row.outcome_json) : null,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

module.exports = {
  computeRegressionHistoryInsights,
  buildDeterministicVerdictIntelligence,
  buildIntelligenceTrace,
  upsertReleaseIntelligence,
  getReleaseIntelligence
};
