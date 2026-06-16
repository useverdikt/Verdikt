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
 *   4. Env-chain link updates
 *   5. VCS status write-back (GitHub/GitLab commit status + PR comment)
 *   6. VCS monitoring window (automatic post-deploy production inference)
 *   7. Outbound verdict webhook (CI/CD callbacks)
 *   8. SSE broadcast (live UI updates)
 */

const { queryOne, queryAll, run } = require("../database");
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
const { getThresholdMap } = require("./workspaceConfig");
const { getLatestSignalMap, getMissingRequiredSignals } = require("./verdictEngine");
const { buildGateCertification } = require("./gateCertification");

async function maybePromoteAfterVerdictIfMergedWhileCollecting(releaseId, nextStatus) {
  try {
    const status = String(nextStatus || "").toUpperCase();
    const certLike = new Set(["CERTIFIED", "CERTIFIED_WITH_OVERRIDE"]);
    if (!certLike.has(status)) return;

    const fresh = await queryOne("SELECT id, workspace_id, environment, pr_number FROM releases WHERE id = ?", [releaseId]);
    if (!fresh) return;
    if (!Number.isFinite(Number(fresh.pr_number))) return;
    if (String(fresh.environment || "").toLowerCase() === "prod") return;

    const blockedRows = await queryAll(
      "SELECT details_json FROM audit_events WHERE release_id = ? AND event_type = ? ORDER BY id DESC LIMIT 20",
      [releaseId, "RELEASE_ENV_PROMOTION_BLOCKED"]
    );
    if (!blockedRows.length) return;

    const mergedToMainWhileCollecting = blockedRows.some((row) => {
      try {
        const details = JSON.parse(row.details_json || "{}");
        const base = String(details.base_branch || "").toLowerCase();
        const requestedEnv = String(details.requested_environment || "").toLowerCase();
        const reason = String(details.reason || "").toLowerCase();
        return reason === "release_still_collecting" && (requestedEnv === "prod" || base === "main" || base === "master");
      } catch {
        return false;
      }
    });
    if (!mergedToMainWhileCollecting) return;

    const fromEnv = fresh.environment || null;
    await run("UPDATE releases SET environment = ?, updated_at = ? WHERE id = ?", ["prod", nowIso(), releaseId]);
    await writeAudit({
      workspaceId: fresh.workspace_id,
      releaseId,
      eventType: "RELEASE_ENV_PROMOTED",
      actorType: "SYSTEM",
      actorName: "github_merge_post_verdict",
      details: {
        from_environment: fromEnv,
        to_environment: "prod",
        pr_number: Number(fresh.pr_number),
        verdict_status: status,
        reason: "merged_to_main_while_collecting_promoted_after_verdict"
      }
    });
  } catch (_) {}
}

/**
 * Run all post-verdict side effects.
 *
 * @param {string} releaseId
 * @param {object} release           – original release row (pre-verdict)
 * @param {string} nextStatus        – the newly committed verdict status
 * @param {Array}  failedSignals     – signals that caused the verdict
 * @param {object} deterministicIntelligence
 * @returns {{ recommendation, certSigRow }}
 */
async function runPostVerdictEffects(releaseId, release, nextStatus, failedSignals, deterministicIntelligence) {
  const freshRelease = (await queryOne("SELECT * FROM releases WHERE id = ?", [releaseId])) || release;

  // 1. Failure mode classification
  try {
    const failedIds = failedSignals.map((f) => f.signal_id).filter(Boolean);
    if (failedIds.length > 0) await classifyFailureModes(releaseId, release.workspace_id, failedIds);
  } catch (_) {}

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

  // 4. If merge to main/master happened while collecting, promote after verdict.
  await maybePromoteAfterVerdictIfMergedWhileCollecting(releaseId, nextStatus);

  // 4b. Persist evidence quality (signal provenance summary for cert record).
  try {
    await persistReleaseEvidenceQuality(releaseId);
  } catch (err) {
    console.error("[evidence_quality] persist failed:", releaseId, err?.message);
  }

  // 5. VCS status write-back (async — does not block)
  try {
    void writeVcsStatus(freshRelease, failedSignals).catch((err) =>
      console.error("[vcs_writeback] async error:", releaseId, err?.message)
    );
  } catch (_) {}

  // 6. VCS monitoring window (automatic post-deploy inference over next 2 hours)
  try {
    await openMonitoringWindow(freshRelease, 120);
  } catch (_) {}

  // 7. Outbound verdict webhook (async — does not block)
  try {
    // Build certified decision context for cert-like statuses to include in webhooks/callbacks
    let certificationContext = null;
    if (certLike.has(nextStatus)) {
      try {
        const [thresholdMap, latest] = await Promise.all([
          getThresholdMap(freshRelease.workspace_id),
          getLatestSignalMap(releaseId)
        ]);
        const missingRequired = await getMissingRequiredSignals(
          freshRelease.workspace_id, releaseId, latest, freshRelease, thresholdMap
        );
        certificationContext = await buildGateCertification({
          release: freshRelease,
          intelligence: deterministicIntelligence ? { verdict: deterministicIntelligence } : null,
          thresholdMap,
          latest,
          missingRequiredSignals: missingRequired
        });
      } catch (_) {}
    }

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
  } catch (_) {}

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
  } catch (_) {}

  return { recommendation, certSigRow };
}

module.exports = { runPostVerdictEffects };
