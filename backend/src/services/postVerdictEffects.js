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

const { queryOne } = require("../database");
const { nowIso } = require("../lib/time");
const { classifyFailureModes } = require("./correlationEngine");
const { computeAndPersistRecommendation } = require("./recommendationEngine");
const { signCertificationRecord } = require("./certSigner");
const { getChainsForRelease, updateChainLinkStatus } = require("./envChain");
const { writeVcsStatus } = require("./vcsWriteback");
const { openMonitoringWindow } = require("./vcsMonitor");
const { deliverVerdictWebhook } = require("./outboundWebhook");
const { broadcastVerdictAndClose } = require("./sseManager");

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
  // 1. Failure mode classification
  try {
    const failedIds = failedSignals.map((f) => f.signal_id).filter(Boolean);
    if (failedIds.length > 0) await classifyFailureModes(releaseId, release.workspace_id, failedIds);
  } catch (_) {}

  // 2. Recommendation engine
  let recommendation = null;
  try {
    const fresh = (await queryOne("SELECT * FROM releases WHERE id = ?", [releaseId])) || release;
    recommendation = await computeAndPersistRecommendation(fresh);
  } catch (err) {
    console.error("[recommendation_engine] failed:", releaseId, err?.message);
  }

  // 3. Certification record signing
  let certSigRow = null;
  const certLike = new Set(["CERTIFIED", "CERTIFIED_WITH_OVERRIDE"]);
  if (certLike.has(nextStatus)) {
    try {
      const fresh = (await queryOne("SELECT * FROM releases WHERE id = ?", [releaseId])) || release;
      certSigRow = await signCertificationRecord(fresh, deterministicIntelligence);
    } catch (err) {
      console.error("[cert_signer] signing failed:", releaseId, err?.message);
    }
  }

  // 4. Env-chain link updates
  try {
    const chainLinks = await getChainsForRelease(releaseId);
    for (const link of chainLinks) {
      await updateChainLinkStatus(link.chain_id, link.environment, nextStatus);
    }
  } catch (_) {}

  // 5. VCS status write-back (async — does not block)
  try {
    const fresh = (await queryOne("SELECT * FROM releases WHERE id = ?", [releaseId])) || release;
    void writeVcsStatus(fresh, failedSignals).catch((err) =>
      console.error("[vcs_writeback] async error:", releaseId, err?.message)
    );
  } catch (_) {}

  // 6. VCS monitoring window (automatic post-deploy inference over next 2 hours)
  try {
    const fresh = (await queryOne("SELECT * FROM releases WHERE id = ?", [releaseId])) || release;
    await openMonitoringWindow(fresh, 120);
  } catch (_) {}

  // 7. Outbound verdict webhook (async — does not block)
  try {
    const fresh = (await queryOne("SELECT * FROM releases WHERE id = ?", [releaseId])) || release;
    void deliverVerdictWebhook(fresh, deterministicIntelligence, certSigRow).catch((err) =>
      console.error("[outbound_webhook] async delivery error:", releaseId, err?.message)
    );
  } catch (_) {}

  // 8. SSE broadcast
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
