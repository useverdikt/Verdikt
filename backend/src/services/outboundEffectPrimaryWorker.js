"use strict";

const { queryOne, run } = require("../database");
const { writeAudit } = require("./audit");
const { log, inc } = require("../lib/observability");
const {
  claimDueOutboundEffects,
  retryOrDeadLetter,
  batchOwner,
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

class LeaseLostError extends Error {
  constructor() {
    super("outbox lease lost before send");
    this.name = "LeaseLostError";
  }
}

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

/**
 * Renew the lease and record that the send is starting, in one guarded write.
 * Returns false if another worker reclaimed the row, so the caller must not send.
 * The renewed lease outlasts the deliverers' own timeouts (15 s max).
 */
async function beginPrimarySend(row, owner, leaseMs, runFn = run) {
  const result = await runFn(
    `UPDATE outbound_effect_outbox
        SET delivery_started_at = NOW(),
            claimed_until = NOW() + ($1::bigint * INTERVAL '1 millisecond'),
            updated_at = NOW()
      WHERE id = $2
        AND state = 'processing'
        AND claimed_by = $3
        AND claimed_until > NOW()`,
    [leaseMs, row.id, owner]
  );
  return Number(result?.changes || 0) === 1;
}

function releaseForRow(current, row) {
  return { ...current, status: row.verdict_status, verdict_issued_at: row.verdict_issued_at };
}

/**
 * Delivers the verdict recorded on the row (not the release's current status),
 * and skips a row when a newer row for the same effect was already delivered,
 * so a retried older verdict never lands after a newer one.
 */
async function deliverPrimaryEffect(row, { queryOneFn = queryOne, beforeSend = async () => true } = {}) {
  const current = await queryOneFn("SELECT * FROM releases WHERE id = $1", [row.release_id]);
  if (!current) return { outcome: "skipped", reason: "release_deleted" };

  const superseded = await queryOneFn(
    `SELECT id FROM outbound_effect_outbox
      WHERE release_id = $1 AND effect_type = $2 AND state = 'delivered'
        AND created_at > $3::timestamptz
      LIMIT 1`,
    [row.release_id, row.effect_type, row.created_at]
  );
  if (superseded) return { outcome: "skipped", reason: "superseded_by_newer_verdict" };

  const release = releaseForRow(current, row);
  const envelope = parseJsonObject(row.envelope_json);
  const failedSignals = Array.isArray(envelope.failed_signals) ? envelope.failed_signals : [];
  const intel = await getReleaseIntelligence(release.id);
  const certSig = await getCertSignaturePublic(release.id);
  const { certification } = await buildGateContext(
    release,
    intel ? { verdict: intel.verdict } : null
  );
  const trajectory =
    row.effect_type === "release_callback"
      ? await computeReleaseTrajectory({
          workspaceId: release.workspace_id,
          releaseId: release.id,
          releaseRow: release
        }).catch(() => null)
      : null;

  const send = {
    vcs_writeback: () => writeVcsStatus(release, failedSignals),
    outbound_webhook: () => deliverVerdictWebhook(release, intel?.verdict, certSig, failedSignals, certification),
    release_callback: () =>
      deliverReleaseCallback(
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
    slack_verdict: () => deliverSlackVerdict(release, failedSignals, certification)
  }[row.effect_type];
  if (!send) return { outcome: "skipped", reason: `unsupported_effect_type:${row.effect_type}` };

  if (!(await beforeSend())) throw new LeaseLostError();
  return requireDelivered(await send(), row.effect_type);
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

/** One network attempt per effect: a failure after the send started is never retried. */
async function deadLetterAttemptedSend(row, owner, error, { runFn = run, auditFn = writeAudit } = {}) {
  const message = String(error?.message || error || "primary delivery failed").slice(0, 1000);
  const result = await runFn(
    `UPDATE outbound_effect_outbox
        SET state = 'dead_letter',
            claimed_by = NULL,
            claimed_until = NULL,
            last_error = $1,
            updated_at = NOW()
      WHERE id = $2
        AND state = 'processing'
        AND claimed_by = $3`,
    [message, row.id, owner]
  );
  if (Number(result?.changes || 0) !== 1) return "ownership_lost";
  try {
    await auditFn({
      workspaceId: row.workspace_id,
      releaseId: row.release_id,
      eventType: "OUTBOUND_EFFECT_PRIMARY_EXHAUSTED",
      actorType: "SYSTEM",
      actorName: "outbound_effect_primary_worker",
      details: {
        outbox_id: row.id,
        effect_type: row.effect_type,
        attempts: Number(row.attempt_count),
        error: message,
        send_attempted: true
      }
    });
  } catch {
    // The durable dead-letter state is authoritative.
  }
  return "dead_letter";
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
  const owner = batchOwner(workerId);
  const attemptsLimit = Number.isFinite(Number(maxAttempts))
    ? Math.min(20, Math.max(1, Math.floor(Number(maxAttempts))))
    : DEFAULT_MAX_ATTEMPTS;
  const claimed = await claimFn({
    limit,
    workerId: owner,
    leaseMs,
    workspaceId,
    maxAttempts: attemptsLimit,
    deliveryMode: "primary"
  });
  const summary = {
    claimed: claimed.length,
    delivered: 0,
    skipped: 0,
    retried: 0,
    dead_lettered: 0
  };

  for (const row of claimed) {
    let sendStarted = false;
    try {
      const result = await deliverFn(row, {
        beforeSend: async () => {
          sendStarted = await beginPrimarySend(row, owner, leaseMs, runFn);
          return sendStarted;
        }
      });
      const finalized = await finalizePrimaryDelivery(row, owner, result, runFn);
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
      let state;
      if (error instanceof LeaseLostError) {
        state = "ownership_lost";
      } else if (sendStarted) {
        state = await deadLetterAttemptedSend(row, owner, error, { runFn, auditFn });
      } else {
        state = await retryOrDeadLetter(row, owner, error, {
          maxAttempts: attemptsLimit,
          runFn,
          auditFn,
          auditEventType: "OUTBOUND_EFFECT_PRIMARY_EXHAUSTED",
          actorName: "outbound_effect_primary_worker"
        });
      }
      if (state === "retry") summary.retried += 1;
      else if (state === "dead_letter") summary.dead_lettered += 1;
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
  beginPrimarySend,
  releaseForRow,
  processDueOutboundPrimaryEffects
};
