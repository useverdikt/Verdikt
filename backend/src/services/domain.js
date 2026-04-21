"use strict";

/**
 * domain.js — Release verdict orchestrator
 *
 * This file has one job: orchestrate a verdict when signals arrive.
 * All other concerns live in dedicated modules:
 *
 *   workspaceConfig.js     — threshold seeding, threshold map, workspace policy
 *   verdictEngine.js       — pure verdict computation (no side effects)
 *   intelligenceBuilder.js — deterministic intelligence, regression history,
 *                            release_intelligence persistence
 *   llmAssist.js           — optional LLM enrichment (fire-and-forget)
 *   overrideAssessor.js    — override justification scoring
 *   thresholdAdvisor.js    — data-driven threshold suggestions
 *   postVerdictEffects.js  — side effects after verdict commit
 *                            (failure modes, recommendation, cert signing,
 *                             env chains, VCS writeback, monitoring window,
 *                             outbound webhook, SSE)
 *
 * Route modules under `routes/` import from domain.js (re-export surface from
 * the modules above). No import paths change when splitting `routes/index.js`.
 */

const { run, queryOne } = require("../database");
const { nowIso } = require("../lib/time");
const { writeAudit } = require("./audit");
const { computeEarlyWarnings, persistEarlyWarning } = require("./earlyWarning");
const { broadcastToRelease } = require("./sseManager");
const { persistReleaseDeltas } = require("./delta");
const { AI_SIGNAL_IDS, ENABLE_ASSISTIVE_LLM, AI_PROVIDER_API_KEY } = require("../config");

// ── Modules extracted from this file ─────────────────────────────────────────
const { ensureWorkspaceSeeded, getThresholdMap, getWorkspacePolicy } = require("./workspaceConfig");
const {
  isAllowedSignalValue,
  getLatestSignalMap,
  getMissingRequiredSignals,
  computeVerdict,
  mapIntegrationSignals,
  resolveReleaseForWorkspaceIngest,
  releaseVerdictLockedAgainstIngest
} = require("./verdictEngine");
const {
  computeRegressionHistoryInsights,
  buildDeterministicVerdictIntelligence,
  buildIntelligenceTrace,
  upsertReleaseIntelligence,
  getReleaseIntelligence
} = require("./intelligenceBuilder");
const { enqueueVerdictAssistiveEnrichment } = require("./llmAssist");
const { assessOverrideJustification } = require("./overrideAssessor");
const { buildThresholdSuggestions } = require("./thresholdAdvisor");
const { maybeEnrichSuggestionReason } = require("./llmAssist");
const { runPostVerdictEffects } = require("./postVerdictEffects");

// ─── Core evaluation pipeline ─────────────────────────────────────────────────

async function evaluateReleaseAfterSignalIngest(release, releaseId, source, inputSignalCount) {
  const latest = await getLatestSignalMap(releaseId);
  const missingRequiredSignals = await getMissingRequiredSignals(release.workspace_id, releaseId, latest);
  const missingAiSignals = missingRequiredSignals.filter((id) => AI_SIGNAL_IDS.includes(id));
  const missingNonAiSignals = missingRequiredSignals.filter((id) => !AI_SIGNAL_IDS.includes(id));
  const policy = await getWorkspacePolicy(release.workspace_id);
  const deadlineMs = release.collection_deadline ? Date.parse(release.collection_deadline) : Number.NaN;
  const deadlinePassed = Number.isFinite(deadlineMs) ? Date.now() >= deadlineMs : true;

  // ── Still collecting: not all signals present and window still open ─────────
  if (!deadlinePassed && missingRequiredSignals.length > 0) {
    await run("UPDATE releases SET status = ?, updated_at = ? WHERE id = ?", [
      "COLLECTING",
      nowIso(),
      releaseId
    ]);

    const thresholdsForWarning = await getThresholdMap(release.workspace_id);
    const ewResult = computeEarlyWarnings(release, latest, thresholdsForWarning, null);
    try {
      await persistEarlyWarning(releaseId, release.workspace_id, ewResult);
    } catch (_) {}

    await writeAudit({
      workspaceId: release.workspace_id,
      releaseId,
      eventType: "SIGNALS_INGESTED",
      actorType: "SYSTEM",
      actorName: source,
      details: {
        signal_count: inputSignalCount,
        computed_status: "COLLECTING",
        missing_required_signals: missingRequiredSignals,
        missing_ai_signals: missingAiSignals,
        missing_non_ai_signals: missingNonAiSignals,
        early_warning: { overall_risk: ewResult.overall_risk, warning_count: ewResult.warnings.length }
      }
    });

    try {
      broadcastToRelease(releaseId, "signal_progress", {
        release_id: releaseId,
        status: "COLLECTING",
        signal_count: inputSignalCount,
        missing_required: missingRequiredSignals.length,
        early_warning: { overall_risk: ewResult.overall_risk, warning_count: ewResult.warnings.length },
        ts: nowIso()
      });
    } catch (_) {}

    return {
      release_id: releaseId,
      status: "COLLECTING",
      collection_deadline: release.collection_deadline,
      missing_required_signals: missingRequiredSignals,
      missing_ai_signals: missingAiSignals,
      failed_signals: [],
      threshold_failed_signals: [],
      missing_signals: [],
      release_deltas: [],
      early_warning: ewResult
    };
  }

  // ── Compute verdict ───────────────────────────────────────────────────────
  const verdict = await computeVerdict(release.workspace_id, releaseId, latest, release);
  if (verdict.deltaAnalysis) {
    await persistReleaseDeltas(releaseId, verdict.deltaAnalysis.pendingInserts);
    const regFailCount = verdict.deltaAnalysis.failures.filter(
      (f) => f.failure_kind === "regression" || (f.rule && String(f.rule).startsWith("regression:"))
    ).length;
    await writeAudit({
      workspaceId: release.workspace_id,
      releaseId,
      eventType: "DELTAS_COMPUTED",
      actorType: "SYSTEM",
      actorName: "delta_engine",
      details: {
        snapshot_row_count: verdict.deltaAnalysis.snapshot.length,
        regression_failure_count: regFailCount,
        no_prior_certified_baseline: verdict.deltaAnalysis.no_prior_certified_baseline === true,
        baseline_release_id: verdict.deltaAnalysis.baseline_release_id ?? null
      }
    });
  }

  const deltaResult = verdict.deltaAnalysis || { failures: [], snapshot: [] };
  const thresholdFailedSignals = verdict.failed_signals;
  const shouldBlockOnMissingAi = policy?.require_ai_eval === 1 && policy?.ai_missing_policy === "block_uncertified";
  const missingSignalFails = [];
  if (missingRequiredSignals.length > 0) {
    missingRequiredSignals.forEach((signalId) => {
      if (AI_SIGNAL_IDS.includes(signalId) && !shouldBlockOnMissingAi) return;
      missingSignalFails.push({ signal_id: signalId, value: null, rule: "required signal missing at evaluation" });
    });
  }

  const failedSignals = [...thresholdFailedSignals, ...missingSignalFails];
  const nextStatus = failedSignals.length === 0 ? "CERTIFIED" : "UNCERTIFIED";
  const prevRow = await queryOne("SELECT status FROM releases WHERE id = ?", [releaseId]);
  const prevStatus = prevRow?.status ?? release.status;

  // ── Build deterministic intelligence ─────────────────────────────────────
  const deltaCtx = verdict.deltaAnalysis != null
    ? {
        no_prior_certified_baseline: verdict.deltaAnalysis.no_prior_certified_baseline === true,
        baseline_release_id: verdict.deltaAnalysis.baseline_release_id ?? null
      }
    : null;

  const regressionFailOnly = thresholdFailedSignals.filter(
    (s) => s.failure_kind === "regression" || (s.rule && String(s.rule).startsWith("regression:"))
  );
  const regressionHistory =
    regressionFailOnly.length > 0
      ? await computeRegressionHistoryInsights(
          release.workspace_id,
          releaseId,
          release.release_type,
          regressionFailOnly.map((s) => s.signal_id)
        )
      : null;

  const deterministicIntelligence = await buildDeterministicVerdictIntelligence({
    release,
    failedSignals,
    missingRequiredSignals,
    nextStatus,
    deltaContext: deltaCtx,
    regressionHistory
  });

  const trace = buildIntelligenceTrace({
    releaseId,
    workspaceId: release.workspace_id,
    releaseType: release.release_type,
    output: deterministicIntelligence
  });
  trace.model = deterministicIntelligence?.model || trace.model;
  trace.prompt_version = deterministicIntelligence?.prompt_version || trace.prompt_version;

  // ── Commit verdict to DB ──────────────────────────────────────────────────
  await run("UPDATE releases SET status = ?, updated_at = ?, verdict_issued_at = ? WHERE id = ?", [
    nextStatus,
    nowIso(),
    nowIso(),
    releaseId
  ]);
  await upsertReleaseIntelligence(releaseId, release.workspace_id, { verdict: deterministicIntelligence, trace });

  // ── Verdict change audit ──────────────────────────────────────────────────
  const certLike = new Set(["CERTIFIED", "CERTIFIED_WITH_OVERRIDE"]);
  if (prevStatus !== nextStatus && certLike.has(prevStatus) && nextStatus === "UNCERTIFIED") {
    await writeAudit({
      workspaceId: release.workspace_id,
      releaseId,
      eventType: "VERDICT_CHANGED",
      actorType: "SYSTEM",
      actorName: "verdict_engine",
      details: {
        from_status: prevStatus,
        to_status: nextStatus,
        summary: `Certification regressed from ${prevStatus} to ${nextStatus}.`
      }
    });
  }
  await writeAudit({
    workspaceId: release.workspace_id,
    releaseId,
    eventType: "SIGNALS_INGESTED",
    actorType: "SYSTEM",
    actorName: source,
    details: {
      signal_count: inputSignalCount,
      computed_status: nextStatus,
      failed_signals: failedSignals,
      threshold_failed_signals: thresholdFailedSignals,
      missing_signals: missingSignalFails,
      missing_required_signals: missingRequiredSignals,
      missing_ai_signals: missingAiSignals,
      missing_non_ai_signals: missingNonAiSignals
    }
  });

  // ── Post-verdict side effects ─────────────────────────────────────────────
  const { recommendation } = await runPostVerdictEffects(
    releaseId, release, nextStatus, failedSignals, deterministicIntelligence
  );

  // ── Optional LLM enrichment (fire-and-forget, never blocks) ──────────────
  if (ENABLE_ASSISTIVE_LLM && !!AI_PROVIDER_API_KEY && typeof fetch === "function") {
    const refreshed = await queryOne("SELECT * FROM releases WHERE id = ?", [releaseId]);
    enqueueVerdictAssistiveEnrichment({
      releaseId,
      workspaceId: release.workspace_id,
      release: refreshed || release,
      failedSignals,
      missingRequiredSignals,
      deterministicIntelligence
    });
  }

  return {
    release_id: releaseId,
    status: nextStatus,
    missing_required_signals: missingRequiredSignals,
    missing_ai_signals: missingAiSignals,
    threshold_failed_signals: thresholdFailedSignals,
    missing_signals: missingSignalFails,
    failed_signals: failedSignals,
    release_deltas: deltaResult.snapshot,
    intelligence: deterministicIntelligence,
    recommendation,
    assistive_enrichment_pending: ENABLE_ASSISTIVE_LLM && !!AI_PROVIDER_API_KEY
  };
}

// ─── Re-exports (routes/* import surface — unchanged) ───────────────────────
module.exports = {
  // workspaceConfig
  ensureWorkspaceSeeded,
  getThresholdMap,
  getWorkspacePolicy,
  // verdictEngine
  isAllowedSignalValue,
  computeVerdict,
  mapIntegrationSignals,
  resolveReleaseForWorkspaceIngest,
  releaseVerdictLockedAgainstIngest,
  // intelligenceBuilder
  getReleaseIntelligence,
  upsertReleaseIntelligence,
  buildIntelligenceTrace,
  // overrideAssessor
  assessOverrideJustification,
  // thresholdAdvisor
  buildThresholdSuggestions,
  // llmAssist
  maybeEnrichSuggestionReason,
  // orchestrator
  evaluateReleaseAfterSignalIngest
};
