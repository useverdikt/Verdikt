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

const { queryOne, transaction } = require("../database");
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
  releaseVerdictLockedAgainstIngest,
  releaseIngestLockError
} = require("./verdictEngine");
const { isProdEnvironment } = require("../lib/releaseStatus");
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
const { enqueuePostVerdictEffects } = require("./postVerdictEffects");
const certificationSnapshots = require("./certificationSnapshots");
const { enqueuePostVerdictOutbox } = require("./outboundEffectOutbox");
const { resolvePendingEscalationsForRelease } = require("./escalationResolution");

// ─── Core evaluation pipeline ─────────────────────────────────────────────────

/**
 * Why the verdict engine must not write this release row, or null when it may.
 * Every engine write re-checks this against a row read under FOR UPDATE.
 */
function evaluationSkipReason(row) {
  if (!row) return "missing";
  const status = String(row.status || "").toUpperCase();
  if (status === "CERTIFICATION_REVOKED") return "revoked";
  if (status === "CERTIFIED" || status === "CERTIFIED_WITH_OVERRIDE") return "already_certified";
  if (status === "UNCERTIFIED" && isProdEnvironment(row.environment)) return "prod_locked";
  return null;
}

function collectionDeadlinePassed(collectionDeadline) {
  const deadlineMs = collectionDeadline ? Date.parse(collectionDeadline) : Number.NaN;
  return Number.isFinite(deadlineMs) ? Date.now() >= deadlineMs : true;
}

/**
 * `expectedStatus` lets a caller that selected the release by status (the
 * collection sweep) commit only if it is still in that status, so two sweeps
 * that loaded the same row cannot both commit a verdict.
 */
async function evaluateReleaseAfterSignalIngest(release, releaseId, source, inputSignalCount, { expectedStatus = null } = {}) {
  const skipReason = (row) =>
    evaluationSkipReason(row) || (expectedStatus && row.status !== expectedStatus ? "status_changed" : null);
  const freshRow = await queryOne(
    "SELECT status, environment, collection_deadline FROM releases WHERE id = $1",
    [releaseId]
  );
  if (skipReason(freshRow)) return null;

  const [latest, thresholdMap] = await Promise.all([
    getLatestSignalMap(releaseId),
    getThresholdMap(release.workspace_id)
  ]);
  const missingRequiredSignals = await getMissingRequiredSignals(
    release.workspace_id,
    releaseId,
    latest,
    release,
    thresholdMap
  );
  const missingAiSignals = missingRequiredSignals.filter((id) => AI_SIGNAL_IDS.includes(id));
  const missingNonAiSignals = missingRequiredSignals.filter((id) => !AI_SIGNAL_IDS.includes(id));
  const collectionDeadline = freshRow.collection_deadline;

  // ── Still collecting: not all signals present and window still open ─────────
  if (!collectionDeadlinePassed(collectionDeadline) && missingRequiredSignals.length > 0) {
    const ewResult = computeEarlyWarnings(release, latest, thresholdMap, null);
    const collectingCommitted = await transaction(async (tx) => {
      const locked = await tx.queryOne(
        "SELECT status, environment FROM releases WHERE id = $1 FOR UPDATE",
        [releaseId]
      );
      if (skipReason(locked)) return false;
      await tx.run("UPDATE releases SET status = $1, updated_at = $2 WHERE id = $3", [
        "COLLECTING",
        nowIso(),
        releaseId
      ]);
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
        },
        tx
      });
      return true;
    });
    if (!collectingCommitted) return null;

    try {
      await persistEarlyWarning(releaseId, release.workspace_id, ewResult);
    } catch (_) {}

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
      collection_deadline: collectionDeadline,
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
  const verdict = await computeVerdict(release.workspace_id, releaseId, latest, release, thresholdMap);
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
  const missingSignalFails = [];
  if (missingRequiredSignals.length > 0) {
    missingRequiredSignals.forEach((signalId) => {
      missingSignalFails.push({ signal_id: signalId, value: null, rule: "required signal missing at evaluation" });
    });
  }
  const ingestedSignalCount = Object.keys(latest).length;
  if (ingestedSignalCount === 0) {
    missingSignalFails.push({
      signal_id: "release",
      value: null,
      rule: "no signals ingested at verdict",
      failure_kind: "no_ingest"
    });
  }

  const failedSignals = [...thresholdFailedSignals, ...missingSignalFails];
  const nextStatus = failedSignals.length === 0 ? "CERTIFIED" : "UNCERTIFIED";
  const certLike = new Set(["CERTIFIED", "CERTIFIED_WITH_OVERRIDE"]);

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
    thresholdFailedSignals,
    missingRequiredSignals,
    nextStatus,
    deltaContext: deltaCtx,
    regressionHistory,
    ingestedSignalCount
  });

  const trace = buildIntelligenceTrace({
    releaseId,
    workspaceId: release.workspace_id,
    releaseType: release.release_type,
    output: deterministicIntelligence
  });
  trace.model = deterministicIntelligence?.model || trace.model;
  trace.prompt_version = deterministicIntelligence?.prompt_version || trace.prompt_version;

  // ── Commit verdict atomically (row lock prevents concurrent double-commit) ─
  const commitResult = await transaction(async (tx) => {
    const locked = await tx.queryOne(
      "SELECT status, environment, verdict_issued_at, collection_deadline FROM releases WHERE id = $1 FOR UPDATE",
      [releaseId]
    );
    const lockedSkipReason = skipReason(locked);
    if (lockedSkipReason) return { skipped: true, reason: lockedSkipReason };
    // A concurrent deadline extension reopened the window; missing signals are not yet a failure.
    if (missingRequiredSignals.length > 0 && !collectionDeadlinePassed(locked.collection_deadline)) {
      return { skipped: true, reason: "collection_window_reopened" };
    }

    const prevStatus = locked.status;
    const commitTimestamp = nowIso();
    const verdictIssuedAt = locked.verdict_issued_at || commitTimestamp;
    await tx.run(
      "UPDATE releases SET status = $1, updated_at = $2, verdict_issued_at = COALESCE(verdict_issued_at, $3) WHERE id = $4",
      [nextStatus, commitTimestamp, verdictIssuedAt, releaseId]
    );
    await upsertReleaseIntelligence(
      releaseId,
      release.workspace_id,
      { verdict: deterministicIntelligence, trace },
      tx
    );
    // Frozen evidence commits with the verdict so the gate never sees a
    // certified release without its snapshot.
    await certificationSnapshots.persistCertificationSnapshot({
      releaseId,
      workspaceId: release.workspace_id,
      thresholdMap,
      signalMap: latest,
      status: nextStatus,
      tx
    });

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
        },
        tx
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
      },
      tx
    });
    await enqueuePostVerdictOutbox({
      tx,
      releaseId,
      workspaceId: release.workspace_id,
      verdictStatus: nextStatus,
      verdictIssuedAt,
      triggerSource: source,
      failedSignals,
      occurrence: locked.verdict_issued_at && prevStatus === nextStatus ? commitTimestamp : null
    });
    if (nextStatus === "CERTIFIED") {
      await resolvePendingEscalationsForRelease(tx, {
        workspaceId: release.workspace_id,
        releaseId,
        releaseStatus: nextStatus,
        trigger: "verdict_engine"
      });
    }

    return { skipped: false, prevStatus, verdictIssuedAt };
  });

  if (commitResult.skipped) {
    return null;
  }

  // ── Post-verdict side effects (async — verdict response returns immediately) ─
  enqueuePostVerdictEffects(releaseId, release, nextStatus, failedSignals, deterministicIntelligence);

  // ── Optional LLM enrichment (fire-and-forget, never blocks) ──────────────
  if (ENABLE_ASSISTIVE_LLM && !!AI_PROVIDER_API_KEY && typeof fetch === "function") {
    const refreshed = await queryOne("SELECT * FROM releases WHERE id = $1", [releaseId]);
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
    recommendation: null,
    post_verdict_effects_pending: true,
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
  releaseIngestLockError,
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
