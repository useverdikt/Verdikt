"use strict";

/**
 * postVerdictEffects.js
 *
 * All side-effects that fire after a verdict is issued. None of these affect
 * the authoritative verdict — they are observability, integration, and
 * intelligence concerns that run after `releases.status` is already committed.
 *
 * Extracted from domain.js. Each effect is isolated in its own try/catch so
 * a failure in one never prevents the others from running.
 *
 * Callers: domain.js → evaluateReleaseAfterSignalIngest
 *
 * Effects (in order):
 *   1. Failure mode classification
 *   2. Recommendation engine (confidence + reasoning)
 *   3. Certification record signing (CERTIFIED releases only)
 *   4. VCS monitoring window (idempotent with bypass-merge prod promotion)
 *   5. Evidence quality persistence
 *   6. VCS status write-back
 *   7. Outbound verdict webhook (CI/CD callbacks)
 *   8. SSE broadcast (live UI updates)
 */

const { queryOne } = require("../database");
const { nowIso } = require("../lib/time");
const { log, inc } = require("../lib/observability");
const { writeAudit } = require("./audit");
const { classifyFailureModes } = require("./correlationEngine");
const { computeAndPersistRecommendation } = require("./recommendationEngine");
const { signCertificationRecord } = require("./certSigner");
const { writeVcsStatus } = require("./vcsWriteback");
const { openMonitoringWindow } = require("./vcsMonitor");
const { persistReleaseEvidenceQuality } = require("./evidenceQuality");
const { deliverVerdictWebhook } = require("./outboundWebhook");
const { deliverReleaseCallback } = require("./releaseCallback");
const { computeReleaseTrajectory } = require("./gateTrajectory");
const { broadcastVerdictAndClose } = require("./sseManager");
const { computeSignalReliability } = require("./signalReliability");
const { buildGateContext } = require("./gateContext");
const { deliverSlackVerdict } = require("./slackNotifier");

async function runPostVerdictEffects(releaseId, release, nextStatus, failedSignals, deterministicIntelligence) {
  const freshRelease = (await queryOne("SELECT * FROM releases WHERE id = $1", [releaseId])) || release;

  // 1. Failure mode classification
  try {
    const failedIds = failedSignals.map((f) => f.signal_id).filter(Boolean);
    if (failedIds.length > 0) await classifyFailureModes(releaseId, release.workspace_id, failedIds);
  } catch (err) {
    inc("post_verdict_failure_modes_classify_failed");
    log("error", "post_verdict_failure_modes_classify_failed", {
      releaseId,
      workspaceId: release.workspace_id,
      error: err?.message
    });
  }

  // 2. Recommendation engine
  let recommendation = null;
  try {
    recommendation = await computeAndPersistRecommendation(freshRelease);
  } catch (err) {
    inc("post_verdict_recommendation_failed");
    log("error", "post_verdict_recommendation_failed", { releaseId, error: err?.message });
  }

  // 3. Certification record signing
  let certSigRow = null;
  const certLike = new Set(["CERTIFIED", "CERTIFIED_WITH_OVERRIDE"]);
  if (certLike.has(nextStatus)) {
    try {
      certSigRow = await signCertificationRecord(freshRelease, deterministicIntelligence);
    } catch (err) {
      inc("post_verdict_cert_signing_failed");
      log("error", "post_verdict_cert_signing_failed", { releaseId, error: err?.message });
    }
  }

  // 4. VCS monitoring window — idempotent with bypass-merge prod promotion.
  // If merge opened a window while still collecting, post-verdict must not open a second one.
  try {
    await openMonitoringWindow(freshRelease, 120);
  } catch (err) {
    inc("post_verdict_open_monitoring_window_failed");
    log("error", "post_verdict_open_monitoring_window_failed", { releaseId, error: err?.message });
  }

  // 5. Persist evidence quality (signal provenance summary for cert record).
  try {
    await persistReleaseEvidenceQuality(releaseId);
  } catch (err) {
    inc("post_verdict_evidence_quality_persist_failed");
    log("error", "post_verdict_evidence_quality_persist_failed", { releaseId, error: err?.message });
  }

  // 6. VCS status write-back (async — does not block)
  try {
    void writeVcsStatus(freshRelease, failedSignals).catch((err) => {
      inc("post_verdict_vcs_writeback_async_error");
      log("error", "post_verdict_vcs_writeback_async_error", { releaseId, error: err?.message });
    });
  } catch (err) {
    inc("post_verdict_vcs_writeback_sync_setup_failed");
    log("error", "post_verdict_vcs_writeback_sync_setup_failed", { releaseId, error: err?.message });
  }

  // 7. Outbound verdict webhook + Slack (async — does not block)
  try {
    const { certification: certificationContext } = await buildGateContext(
      freshRelease,
      deterministicIntelligence ? { verdict: deterministicIntelligence } : null
    );

    void deliverVerdictWebhook(freshRelease, deterministicIntelligence, certSigRow, failedSignals, certificationContext).catch((err) => {
      inc("post_verdict_outbound_webhook_delivery_error");
      log("error", "post_verdict_outbound_webhook_delivery_error", { releaseId, error: err?.message });
    });
    const trajectory = await computeReleaseTrajectory({
      workspaceId: freshRelease.workspace_id,
      releaseId,
      releaseRow: freshRelease
    }).catch(() => null);
    void deliverReleaseCallback(freshRelease, deterministicIntelligence, {
      trajectory: trajectory?.trajectory ?? "UNKNOWN",
      degrading_signals: trajectory?.degrading_signals ?? [],
      trend_note: trajectory?.trend_note ?? null
    }, failedSignals, certificationContext).catch((err) => {
      inc("post_verdict_release_callback_delivery_error");
      log("error", "post_verdict_release_callback_delivery_error", { releaseId, error: err?.message });
    });

    void deliverSlackVerdict(freshRelease, failedSignals, certificationContext).catch((err) => {
      inc("post_verdict_slack_notifier_error");
      log("error", "post_verdict_slack_notifier_error", { releaseId, error: err?.message });
    });
  } catch (err) {
    inc("post_verdict_outbound_effects_setup_failed");
    log("error", "post_verdict_outbound_effects_setup_failed", { releaseId, error: err?.message });
  }

  // 8. Signal reliability recompute (async — does not block)
  const verdictIssued = new Set(["CERTIFIED", "CERTIFIED_WITH_OVERRIDE", "UNCERTIFIED"]);
  if (verdictIssued.has(nextStatus)) {
    try {
      void computeSignalReliability(release.workspace_id).catch((err) => {
        inc("post_verdict_signal_reliability_recompute_error");
        log("error", "post_verdict_signal_reliability_recompute_error", { releaseId, error: err?.message });
      });
    } catch (_) {}
  }

  // 9. SSE broadcast
  try {
    broadcastVerdictAndClose(releaseId, {
      release_id: releaseId,
      status: nextStatus,
      failed_signals: failedSignals,
      verdict_issued_at: nowIso()
    });
  } catch (err) {
    inc("post_verdict_sse_broadcast_failed");
    log("error", "post_verdict_sse_broadcast_failed", { releaseId, error: err?.message });
  }

  return { recommendation, certSigRow };
}

/** Fire-and-forget post-verdict side effects — keeps signal-ingest responses fast. */
function enqueuePostVerdictEffects(releaseId, release, nextStatus, failedSignals, deterministicIntelligence) {
  setImmediate(() => {
    void runPostVerdictEffects(releaseId, release, nextStatus, failedSignals, deterministicIntelligence).catch((err) => {
      inc("post_verdict_effects_async_run_failed");
      log("error", "post_verdict_effects_async_run_failed", {
        releaseId,
        error: err?.message || String(err)
      });
    });
  });
}

module.exports = { runPostVerdictEffects, enqueuePostVerdictEffects };
