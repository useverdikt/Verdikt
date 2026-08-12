"use strict";

const { transaction, queryOne, run } = require("../database");
const { writeAudit } = require("./audit");
const { log, inc } = require("../lib/observability");
const {
  canonicalHash,
  buildLegacyEffectInput
} = require("./outboundEffectLegacyObservation");

const DEFAULT_BATCH_SIZE = 25;
const DEFAULT_LEASE_MS = 120_000;
const DEFAULT_MAX_ATTEMPTS = 6;
const BACKOFF_MS = [1_000, 5_000, 15_000, 60_000, 300_000, 900_000];

class RetryableShadowComparisonError extends Error {
  constructor(message) {
    super(message);
    this.name = "RetryableShadowComparisonError";
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

function normalizedTimestamp(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value || "") : parsed.toISOString();
}

function comparison(expected, actual, metadata = {}) {
  const expectedHash = canonicalHash(expected);
  const actualHash = canonicalHash(actual);
  return {
    outcome: expectedHash === actualHash ? "matched" : "mismatch",
    expected,
    actual,
    expected_hash: expectedHash,
    actual_hash: actualHash,
    ...metadata
  };
}

function requireSuccessfulLegacyDelivery(
  result,
  { responseStatus = null, error = null, outcome = null } = {}
) {
  const numericStatus = responseStatus == null ? null : Number(responseStatus);
  const non2xx =
    numericStatus != null &&
    (!Number.isFinite(numericStatus) || numericStatus < 200 || numericStatus >= 300);
  const failedOutcome = outcome != null && outcome !== "succeeded";
  if (!non2xx && !error && !failedOutcome) return result;
  return {
    ...result,
    outcome: "mismatch",
    reason: "legacy_delivery_failed"
  };
}

async function compareOutboundWebhook(row, release, envelope, queryOneFn) {
  const delivery = await queryOneFn(
    `SELECT payload_json, response_status, error_message, delivered_at
       FROM outbound_webhook_deliveries
      WHERE release_id = $1 AND event_type = $2
      ORDER BY id DESC
      LIMIT 1`,
    [row.release_id, row.verdict_status]
  );
  if (!delivery) {
    const webhook = await queryOneFn(
      `SELECT id, events
         FROM outbound_webhooks
        WHERE workspace_id = $1 AND enabled = 1`,
      [row.workspace_id]
    );
    if (!webhook) return { outcome: "skipped", reason: "no_outbound_webhook" };
    const subscribed = String(webhook.events || "")
      .split(",")
      .map((event) => event.trim())
      .filter(Boolean);
    if (!subscribed.includes(row.verdict_status)) {
      return { outcome: "skipped", reason: "event_not_subscribed" };
    }
    throw new RetryableShadowComparisonError("legacy outbound webhook delivery not observed");
  }

  const payload = parseJsonObject(delivery.payload_json, null);
  if (!payload) throw new Error("legacy outbound webhook payload is invalid JSON");
  const failedSignals = Array.isArray(envelope.failed_signals) ? envelope.failed_signals : [];
  const expected = {
    event: row.verdict_status,
    release_id: row.release_id,
    workspace_id: row.workspace_id,
    status: row.verdict_status,
    verdict_issued_at: normalizedTimestamp(row.verdict_issued_at),
    failed_signals: failedSignals
  };
  const actual = {
    event: payload.event,
    release_id: payload.release_id,
    workspace_id: payload.workspace_id,
    status: payload.status,
    verdict_issued_at: normalizedTimestamp(payload.verdict_issued_at),
    failed_signals: Array.isArray(payload.failed_signals) ? payload.failed_signals : []
  };
  const result = comparison(expected, actual, {
    legacy_response_status: delivery.response_status,
    legacy_error: delivery.error_message || null,
    legacy_observed_at: delivery.delivered_at
  });
  return requireSuccessfulLegacyDelivery(result, {
    responseStatus: delivery.response_status,
    error: delivery.error_message
  });
}

async function compareVcsWriteback(row, release, _envelope, queryOneFn) {
  if (!release.commit_sha && !release.pr_number) {
    return { outcome: "skipped", reason: "no_vcs_target" };
  }

  const integration = await queryOneFn(
    `SELECT provider
       FROM vcs_integrations
      WHERE workspace_id = $1 AND enabled = 1`,
    [row.workspace_id]
  );
  const delivery = await queryOneFn(
    `SELECT provider, commit_sha, pr_number, status_sent, response_code, error_message, delivered_at
       FROM vcs_status_deliveries
      WHERE release_id = $1 AND status_sent = $2
      ORDER BY id DESC
      LIMIT 1`,
    [row.release_id, row.verdict_status]
  );
  if (!delivery) {
    if (!integration) return { outcome: "skipped", reason: "no_vcs_integration" };
    throw new RetryableShadowComparisonError("legacy VCS writeback not observed");
  }

  const expected = {
    provider: integration?.provider || delivery.provider,
    commit_sha: release.commit_sha || null,
    pr_number: release.pr_number == null ? null : Number(release.pr_number),
    status_sent: row.verdict_status
  };
  const actual = {
    provider: delivery.provider,
    commit_sha: delivery.commit_sha || null,
    pr_number: delivery.pr_number == null ? null : Number(delivery.pr_number),
    status_sent: delivery.status_sent
  };
  const result = comparison(expected, actual, {
    legacy_response_status: delivery.response_code,
    legacy_error: delivery.error_message || null,
    legacy_observed_at: delivery.delivered_at,
    provider_source: integration ? "current_integration" : "legacy_delivery"
  });
  return requireSuccessfulLegacyDelivery(result, {
    responseStatus: delivery.response_code,
    error: delivery.error_message
  });
}

function compareLegacyObservation(row, release, envelope, label) {
  const observation = parseJsonObject(row.legacy_comparison_json, null);
  if (!observation) {
    throw new RetryableShadowComparisonError(`legacy ${label} delivery not observed`);
  }
  const expected = buildLegacyEffectInput({
    release: {
      ...release,
      status: row.verdict_status,
      verdict_issued_at: row.verdict_issued_at
    },
    failedSignals: Array.isArray(envelope.failed_signals) ? envelope.failed_signals : []
  });
  const result = comparison(expected, observation.input || {}, {
    comparison_scope: "delivery_input",
    legacy_delivery_outcome: observation.outcome || null,
    legacy_response_status: row.legacy_response_status ?? null,
    legacy_error_code: row.legacy_error_code || null,
    legacy_payload_hash: observation.payload_hash || null,
    legacy_observed_at: row.legacy_observed_at || observation.observed_at || null
  });
  return requireSuccessfulLegacyDelivery(result, {
    responseStatus: row.legacy_response_status,
    error: row.legacy_error_code,
    outcome: observation.outcome || null
  });
}

async function compareReleaseCallback(row, release, envelope) {
  if (row.legacy_observed_at) {
    return compareLegacyObservation(row, release, envelope, "release callback");
  }
  if (!String(release.callback_url || "").trim()) {
    return { outcome: "skipped", reason: "no_callback_url" };
  }
  throw new RetryableShadowComparisonError("legacy release callback delivery not observed");
}

async function compareSlackVerdict(row, release, envelope, queryOneFn) {
  if (row.legacy_observed_at) {
    return compareLegacyObservation(row, release, envelope, "Slack verdict");
  }
  const policy = await queryOneFn(
    `SELECT slack_webhook_url
       FROM workspace_policies
      WHERE workspace_id = $1`,
    [row.workspace_id]
  );
  if (!String(policy?.slack_webhook_url || "").trim()) {
    return { outcome: "skipped", reason: "no_slack_webhook" };
  }
  throw new RetryableShadowComparisonError("legacy Slack verdict delivery not observed");
}

async function compareShadowIntent(row, { queryOneFn = queryOne } = {}) {
  const release = await queryOneFn("SELECT * FROM releases WHERE id = $1", [row.release_id]);
  if (!release) return { outcome: "skipped", reason: "release_deleted" };
  const envelope = parseJsonObject(row.envelope_json);

  switch (row.effect_type) {
    case "outbound_webhook":
      return compareOutboundWebhook(row, release, envelope, queryOneFn);
    case "vcs_writeback":
      return compareVcsWriteback(row, release, envelope, queryOneFn);
    case "release_callback":
      return compareReleaseCallback(row, release, envelope);
    case "slack_verdict":
      return compareSlackVerdict(row, release, envelope, queryOneFn);
    default:
      return { outcome: "unverifiable", reason: `unsupported_effect_type:${row.effect_type}` };
  }
}

async function claimDueOutboundEffects({
  limit = DEFAULT_BATCH_SIZE,
  workerId,
  leaseMs = DEFAULT_LEASE_MS,
  workspaceId = null,
  transactionFn = transaction
}) {
  const owner = String(workerId || "").trim();
  if (!owner) throw new Error("outbox workerId is required");
  const batchLimit = Math.min(100, Math.max(1, Number(limit) || DEFAULT_BATCH_SIZE));
  const boundedLeaseMs = Math.min(30 * 60_000, Math.max(1_000, Number(leaseMs) || DEFAULT_LEASE_MS));
  const workspaceScope = String(workspaceId || "").trim() || null;

  return transactionFn((tx) =>
    tx.queryAll(
      `WITH due AS (
         SELECT id
           FROM outbound_effect_outbox
          WHERE ((
                  state IN ('pending', 'retry')
              AND next_attempt_at <= NOW()
                )
             OR (
                  state = 'processing'
              AND claimed_until <= NOW()
                ))
            AND ($4::text IS NULL OR workspace_id = $4)
          ORDER BY
            CASE WHEN state = 'processing' THEN claimed_until ELSE next_attempt_at END ASC,
            id ASC
          LIMIT $1
          FOR UPDATE SKIP LOCKED
       )
       UPDATE outbound_effect_outbox outbox
          SET state = 'processing',
              claimed_by = $2,
              claimed_until = NOW() + ($3::bigint * INTERVAL '1 millisecond'),
              attempt_count = outbox.attempt_count + 1,
              updated_at = NOW()
         FROM due
        WHERE outbox.id = due.id
       RETURNING outbox.*`,
      [batchLimit, owner, boundedLeaseMs, workspaceScope]
    )
  );
}

function terminalStateForOutcome(outcome) {
  if (outcome === "matched") return "shadow_matched";
  if (outcome === "mismatch") return "shadow_mismatch";
  if (outcome === "skipped") return "shadow_skipped";
  return "shadow_unverifiable";
}

async function finalizeShadowComparison(row, workerId, result, runFn = run) {
  const state = terminalStateForOutcome(result.outcome);
  return runFn(
    `UPDATE outbound_effect_outbox
        SET state = $1,
            payload_json = $2::jsonb,
            payload_hash = $3,
            shadow_result_json =
              COALESCE(shadow_result_json, '{}'::jsonb) || $4::jsonb,
            claimed_by = NULL,
            claimed_until = NULL,
            last_error = NULL,
            updated_at = NOW()
      WHERE id = $5
        AND state = 'processing'
        AND claimed_by = $6`,
    [
      state,
      JSON.stringify(result.expected || null),
      result.expected_hash || null,
      JSON.stringify(result),
      row.id,
      workerId
    ]
  );
}

function backoffMsForAttempt(attempt) {
  const index = Math.min(Math.max(Number(attempt) - 1, 0), BACKOFF_MS.length - 1);
  return BACKOFF_MS[index];
}

async function retryOrDeadLetter(
  row,
  workerId,
  error,
  { maxAttempts = DEFAULT_MAX_ATTEMPTS, runFn = run, auditFn = writeAudit } = {}
) {
  const message = String(error?.message || error || "shadow comparison failed").slice(0, 1000);
  if (Number(row.attempt_count) >= maxAttempts) {
    await runFn(
      `UPDATE outbound_effect_outbox
          SET state = 'dead_letter',
              claimed_by = NULL,
              claimed_until = NULL,
              last_error = $1,
              updated_at = NOW()
        WHERE id = $2
          AND state = 'processing'
          AND claimed_by = $3`,
      [message, row.id, workerId]
    );
    try {
      await auditFn({
        workspaceId: row.workspace_id,
        releaseId: row.release_id,
        eventType: "OUTBOUND_EFFECT_SHADOW_EXHAUSTED",
        actorType: "SYSTEM",
        actorName: "outbound_effect_shadow_worker",
        details: {
          outbox_id: row.id,
          effect_type: row.effect_type,
          attempts: Number(row.attempt_count),
          error: message
        }
      });
    } catch {
      // The durable dead-letter state is authoritative; audit failure must not
      // cause the batch to reclaim and process the row again.
    }
    return "dead_letter";
  }

  const nextAttemptAt = new Date(Date.now() + backoffMsForAttempt(row.attempt_count)).toISOString();
  await runFn(
    `UPDATE outbound_effect_outbox
        SET state = 'retry',
            next_attempt_at = $1::timestamptz,
            claimed_by = NULL,
            claimed_until = NULL,
            last_error = $2,
            updated_at = NOW()
      WHERE id = $3
        AND state = 'processing'
        AND claimed_by = $4`,
    [nextAttemptAt, message, row.id, workerId]
  );
  return "retry";
}

async function processDueOutboundEffects({
  limit = DEFAULT_BATCH_SIZE,
  workerId,
  leaseMs = DEFAULT_LEASE_MS,
  workspaceId = null,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  claimFn = claimDueOutboundEffects,
  compareFn = compareShadowIntent,
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
    matched: 0,
    mismatched: 0,
    skipped: 0,
    unverifiable: 0,
    retried: 0,
    dead_lettered: 0
  };

  for (const row of claimed) {
    try {
      const result = await compareFn(row);
      const finalized = await finalizeShadowComparison(row, workerId, result, runFn);
      if (Number(finalized?.changes || 0) !== 1) {
        incFn("outbox_shadow_ownership_lost");
        logFn("warn", "outbox_shadow_ownership_lost", {
          outboxId: row.id,
          releaseId: row.release_id,
          effectType: row.effect_type
        });
        continue;
      }
      if (result.outcome === "matched") summary.matched += 1;
      else if (result.outcome === "mismatch") summary.mismatched += 1;
      else if (result.outcome === "skipped") summary.skipped += 1;
      else summary.unverifiable += 1;
      incFn(`outbox_shadow_${result.outcome}`);
      logFn(result.outcome === "mismatch" ? "warn" : "info", `outbox_shadow_${result.outcome}`, {
        outboxId: row.id,
        releaseId: row.release_id,
        effectType: row.effect_type,
        reason: result.reason
      });
    } catch (error) {
      const state = await retryOrDeadLetter(row, workerId, error, {
        maxAttempts: attemptsLimit,
        runFn,
        auditFn
      });
      if (state === "retry") summary.retried += 1;
      else summary.dead_lettered += 1;
      incFn(`outbox_shadow_${state}`);
      logFn(state === "retry" ? "warn" : "error", `outbox_shadow_${state}`, {
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
  RetryableShadowComparisonError,
  BACKOFF_MS,
  DEFAULT_BATCH_SIZE,
  DEFAULT_LEASE_MS,
  DEFAULT_MAX_ATTEMPTS,
  canonicalHash,
  requireSuccessfulLegacyDelivery,
  compareShadowIntent,
  claimDueOutboundEffects,
  processDueOutboundEffects,
  finalizeShadowComparison,
  retryOrDeadLetter
};
