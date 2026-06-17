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
  const freshRelease = (await queryOne("SELECT * FROM releases WHERE id = ?", [releaseId])) || release;

  // 1. Failure mode classification
  try {
    const failedIds = failedSignals.map((f) => f.signal_id).filter(Boolean);
    if (failedIds.length > 0) await classifyFailureModes(releaseId, release.workspace_id, failedIds);
  } catch (err) {
    console.error("[failure_modes] classify failed:", releaseId, err?.message);
  }

  // 2. Recommendation engine
  let recommendation = null;
  try {
    recommendation = await computeAndPersistRecommendation(freshRelease);
  } catch (err) {
    console.error("[recommendation_engine] failed:", releaseId, err?.message);
  }

  // 3. Certification record signing
  let certSigRow = null;
  const certLike = new Set(["CERTIFIED", "CERTIFIED_WITH_OVERRIDE"]);
  if (certLike.has(nextStatus)) {
    try {
      certSigRow = await signCertificationRecord(freshRelease, deterministicIntelligence);
    } catch (err) {
      console.error("[cert_signer] signing failed:", releaseId, err?.message);
    }
  }

  // 4. VCS monitoring window — idempotent with bypass-merge prod promotion.
  // If merge opened a window while still collecting, post-verdict must not open a second one.
  try {
    await openMonitoringWindow(freshRelease, 120);
  } catch (err) {
    console.error("[vcs_monitor] open window failed:", releaseId, err?.message);
  }

  // 5. Persist evidence quality (signal provenance summary for cert record).
  try {
    await persistReleaseEvidenceQuality(releaseId);
  } catch (err) {
    console.error("[evidence_quality] persist failed:", releaseId, err?.message);
  }

  // 6. VCS status write-back (async — does not block)
  try {
    void writeVcsStatus(freshRelease, failedSignals).catch((err) =>
      console.error("[vcs_writeback] async error:", releaseId, err?.message)
    );
  } catch (err) {
    console.error("[vcs_writeback] sync setup failed:", releaseId, err?.message);
  }

  // 7. Outbound verdict webhook + Slack (async — does not block)
  try {
    const { certification: certificationContext } = await buildGateContext(
      freshRelease,
      deterministicIntelligence ? { verdict: deterministicIntelligence } : null
    );

    void deliverVerdictWebhook(freshRelease, deterministicIntelligence, certSigRow, failedSignals, certificationContext).catch((err) =>
      console.error("[outbound_webhook] async delivery error:", releaseId, err?.message)
    );
    const trajectory = await computeReleaseTrajectory({
      workspaceId: freshRelease.workspace_id,
      releaseId,
      releaseRow: freshRelease
    }).catch(() => null);
    void deliverReleaseCallback(freshRelease, deterministicIntelligence, {
      trajectory: trajectory?.trajectory ?? "UNKNOWN",
      degrading_signals: trajectory?.degrading_signals ?? [],
      trend_note: trajectory?.trend_note ?? null
    }, failedSignals, certificationContext).catch((err) => console.error("[release_callback] async delivery error:", releaseId, err?.message));

    void deliverSlackVerdict(freshRelease, failedSignals, certificationContext).catch((err) =>
      console.error("[slack_notifier] async error:", releaseId, err?.message)
    );
  } catch (err) {
    console.error("[outbound_effects] webhook/callback setup failed:", releaseId, err?.message);
  }

  // 8. Signal reliability recompute (async — does not block)
  const verdictIssued = new Set(["CERTIFIED", "CERTIFIED_WITH_OVERRIDE", "UNCERTIFIED"]);
  if (verdictIssued.has(nextStatus)) {
    try {
      void computeSignalReliability(release.workspace_id).catch((err) =>
        console.error("[signal_reliability] async recompute failed:", releaseId, err?.message)
      );
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
    console.error("[sse_broadcast] failed:", releaseId, err?.message);
  }

  return { recommendation, certSigRow };
}

module.exports = { runPostVerdictEffects };
