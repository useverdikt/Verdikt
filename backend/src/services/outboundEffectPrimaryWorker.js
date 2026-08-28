"use strict";

const { queryOne, run } = require("../database");
const { writeAudit } = require("./audit");
const { log, inc } = require("../lib/observability");
const {
  claimDueOutboundEffects,
  retryOrDeadLetter,
  DEFAULT_BATCH_SIZE,
  DEFAULT_LEASE_MS,
  DEFAULT_MAX_ATTEMPTS
} = require("./outboundEffectShadowWorker");
const { writeVcsStatus } = require("./vcsWriteback");
const { deliverVerdictWebhook } = require("./outboundWebhook");
const { deliverReleaseCallback } = require("./releaseCallback");
const { deliverSlackVerdict } = require("./slackNotifier");
const { getReleaseIntelligence } = require("./intelligenceBuilder");
const { getCertSignaturePublic } = require("./certSigner");
const { buildGateContext } = require("./gateContext");
const { computeReleaseTrajectory } = require("./gateTrajectory");

function parseJsonObject(value, fallback = {}) {
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(value || "{}");
  } catch {
    return fallback;
  }
}

function requireDelivered(result, label) {
  if (!result || result.skipped) {
    return { outcome: "skipped", reason: result?.reason || `${label}_skipped` };
  }
  if (result.delivered === false || result.ok === false) {
    throw new Error(result.error || result.reason || `${label} delivery failed`);
  }
  return { outcome: "delivered", reason: result.reason || null };
}

async function deliverPrimaryEffect(row, { queryOneFn = queryOne } = {}) {
  const release = await queryOneFn("SELECT * FROM releases WHERE id = $1", [row.release_id]);
  if (!release) return { outcome: "skipped", reason: "release_deleted" };

  const envelope = parseJsonObject(row.envelope_json);
  const failedSignals = Array.isArray(envelope.failed_signals) ? envelope.failed_signals : [];
  const intel = await getReleaseIntelligence(release.id);
  const certSig = await getCertSignaturePublic(release.id);
  const { certification } = await buildGateContext(
    release,
    intel ? { verdict: intel.verdict } : null
  );

  switch (row.effect_type) {
    case "vcs_writeback":
      return requireDelivered(await writeVcsStatus(release, failedSignals), "vcs_writeback");
    case "outbound_webhook":
      return requireDelivered(
        await deliverVerdictWebhook(release, intel?.verdict, certSig, failedSignals, certification),
        "outbound_webhook"
      );
    case "release_callback": {
      const trajectory = await computeReleaseTrajectory({
        workspaceId: release.workspace_id,
        releaseId: release.id,
        releaseRow: release
      }).catch(() => null);
      return requireDelivered(
        await deliverReleaseCallback(
          release,
          intel?.verdict,
          {
            trajectory: trajectory?.trajectory ?? "UNKNOWN",
            degrading_signals: trajectory?.degrading_signals ?? [],
            trend_note: trajectory?.trend_note ?? null
          },
          failedSignals,
          certification
        ),
        "release_callback"
      );
    }
    case "slack_verdict":
      return requireDelivered(
        await deliverSlackVerdict(release, failedSignals, certification),
        "slack_verdict"
      );
    default:
      return { outcome: "skipped", reason: `unsupported_effect_type:${row.effect_type}` };
  }
}

async function finalizePrimaryDelivery(row, workerId, result, runFn = run) {
  return runFn(
    `UPDATE outbound_effect_outbox
        SET state = 'delivered',
            delivered_at = NOW(),
            payload_json = COALESCE(payload_json, '{}'::jsonb) || $1::jsonb,
            last_error = NULL,
            claimed_by = NULL,
            claimed_until = NULL,
            updated_at = NOW()
      WHERE id = $2
        AND state = 'processing'
        AND claimed_by = $3`,
    [JSON.stringify(result || {}), row.id, workerId]
  );
}

async function processDueOutboundPrimaryEffects({
  limit = DEFAULT_BATCH_SIZE,
  workerId,
  leaseMs = DEFAULT_LEASE_MS,
  workspaceId = null,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  claimFn = claimDueOutboundEffects,
  deliverFn = deliverPrimaryEffect,
  runFn = run,
  auditFn = writeAudit,
  logFn = log,
  incFn = inc
} = {}) {
  const claimed = await claimFn({ limit, workerId, leaseMs, workspaceId });
  const attemptsLimit = Number.isFinite(Number(maxAttempts))
    ? Math.min(20, Math.max(1, Math.floor(Number(maxAttempts))))
    : DEFAULT_MAX_ATTEMPTS;
  const summary = {
    claimed: claimed.length,
    delivered: 0,
    skipped: 0,
    retried: 0,
    dead_lettered: 0
  };

  for (const row of claimed) {
    try {
      const result = await deliverFn(row);
      const finalized = await finalizePrimaryDelivery(row, workerId, result, runFn);
      if (Number(finalized?.changes || 0) !== 1) {
        incFn("outbox_primary_ownership_lost");
        logFn("warn", "outbox_primary_ownership_lost", {
          outboxId: row.id,
          releaseId: row.release_id,
          effectType: row.effect_type
        });
        continue;
      }
      if (result.outcome === "skipped") summary.skipped += 1;
      else summary.delivered += 1;
      incFn(`outbox_primary_${result.outcome || "delivered"}`);
      logFn("info", `outbox_primary_${result.outcome || "delivered"}`, {
        outboxId: row.id,
        releaseId: row.release_id,
        effectType: row.effect_type,
        reason: result.reason
      });
    } catch (error) {
      const state = await retryOrDeadLetter(row, workerId, error, {
        maxAttempts: attemptsLimit,
        runFn,
        auditFn,
        auditEventType: "OUTBOUND_EFFECT_PRIMARY_EXHAUSTED",
        actorName: "outbound_effect_primary_worker"
      });
      if (state === "retry") summary.retried += 1;
      else summary.dead_lettered += 1;
      incFn(`outbox_primary_${state}`);
      logFn(state === "retry" ? "warn" : "error", `outbox_primary_${state}`, {
        outboxId: row.id,
        releaseId: row.release_id,
        effectType: row.effect_type,
        attempt: Number(row.attempt_count),
        error: String(error?.message || error).slice(0, 500)
      });
    }
  }

  return summary;
}

module.exports = {
  deliverPrimaryEffect,
  finalizePrimaryDelivery,
  processDueOutboundPrimaryEffects
};
