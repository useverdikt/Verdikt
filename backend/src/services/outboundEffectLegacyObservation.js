"use strict";

const crypto = require("crypto");
const { run } = require("../database");
const { OUTBOX_MODE } = require("../config");
const { nowIso } = require("../lib/time");
const { log, inc } = require("../lib/observability");
const { buildOutboxIdempotencyKey } = require("./outboundEffectOutbox");

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])])
  );
}

function canonicalHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function normalizedTimestamp(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? String(value || "") : parsed.toISOString();
}

function buildLegacyEffectInput({ release, failedSignals = [] }) {
  return {
    release_id: String(release?.id || ""),
    workspace_id: String(release?.workspace_id || ""),
    status: String(release?.status || ""),
    verdict_issued_at: normalizedTimestamp(release?.verdict_issued_at),
    failed_signals: Array.isArray(failedSignals) ? failedSignals : []
  };
}

function payloadForHash(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const copy = { ...payload };
  delete copy.sent_at;
  return copy;
}

/**
 * Records what the authoritative legacy path attempted. This helper is
 * deliberately fail-open so an observation write can never alter delivery.
 */
async function recordLegacyEffectObservation({
  release,
  effectType,
  failedSignals = [],
  payload = null,
  outcome,
  responseStatus = null,
  errorCode = null,
  mode = OUTBOX_MODE,
  runFn = run,
  logFn = log,
  incFn = inc
}) {
  if (mode !== "shadow") return { recorded: false, reason: "outbox_disabled" };
  try {
    if (!release?.id || !release?.workspace_id || !release?.status || !release?.verdict_issued_at) {
      throw new Error("legacy effect observation requires release verdict identity");
    }
    const input = buildLegacyEffectInput({ release, failedSignals });
    const observedAt = nowIso();
    const observation = {
      schema_version: 1,
      effect_type: String(effectType),
      outcome: String(outcome || "unknown"),
      input,
      input_hash: canonicalHash(input),
      payload_hash: payload == null ? null : canonicalHash(payloadForHash(payload)),
      observed_at: observedAt
    };
    const safeErrorCode =
      errorCode == null
        ? null
        : String(errorCode).toLowerCase().replace(/[^a-z0-9_.:-]/g, "_").slice(0, 100);
    const idempotencyKey = buildOutboxIdempotencyKey({
      releaseId: release.id,
      effectType,
      verdictStatus: release.status,
      verdictIssuedAt: release.verdict_issued_at
    });
    const result = await runFn(
      `UPDATE outbound_effect_outbox
          SET legacy_comparison_json = $1::jsonb,
              legacy_comparison_hash = $2,
              legacy_observed_at = $3::timestamptz,
              legacy_response_status = $4,
              legacy_error_code = $5,
              state = CASE
                WHEN state IN ('shadow_unverifiable', 'dead_letter') THEN 'pending'
                ELSE state
              END,
              next_attempt_at = CASE
                WHEN state IN ('shadow_unverifiable', 'dead_letter') THEN NOW()
                ELSE next_attempt_at
              END,
              claimed_by = CASE
                WHEN state IN ('shadow_unverifiable', 'dead_letter') THEN NULL
                ELSE claimed_by
              END,
              claimed_until = CASE
                WHEN state IN ('shadow_unverifiable', 'dead_letter') THEN NULL
                ELSE claimed_until
              END,
              last_error = CASE
                WHEN state IN ('shadow_unverifiable', 'dead_letter') THEN NULL
                ELSE last_error
              END,
              updated_at = NOW()
        WHERE idempotency_key = $6
          AND legacy_observed_at IS NULL`,
      [
        JSON.stringify(observation),
        observation.input_hash,
        observedAt,
        responseStatus == null ? null : Number(responseStatus),
        safeErrorCode,
        idempotencyKey
      ]
    );
    if (Number(result?.changes || 0) > 0) incFn("outbox_legacy_observation_recorded");
    return { recorded: Number(result?.changes || 0) > 0, observation };
  } catch (observationError) {
    logFn("warn", "outbox_legacy_observation_failed", {
      releaseId: release?.id,
      effectType,
      error: String(observationError?.message || observationError).slice(0, 500)
    });
    incFn("outbox_legacy_observation_failed");
    return {
      recorded: false,
      error: String(observationError?.message || observationError)
    };
  }
}

module.exports = {
  canonicalHash,
  buildLegacyEffectInput,
  recordLegacyEffectObservation
};
