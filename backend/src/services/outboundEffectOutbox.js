"use strict";

const crypto = require("crypto");
const { OUTBOX_MODE } = require("../config");

const POST_VERDICT_EFFECT_TYPES = Object.freeze([
  "vcs_writeback",
  "outbound_webhook",
  "release_callback",
  "slack_verdict"
]);

function normalizeTimestamp(value) {
  const parsed = new Date(value);
  if (!value || Number.isNaN(parsed.getTime())) {
    throw new Error("outbox verdictIssuedAt must be a valid timestamp");
  }
  return parsed.toISOString();
}

function buildOutboxIdempotencyKey({ releaseId, effectType, verdictStatus, verdictIssuedAt, occurrence = null }) {
  const timestamp = normalizeTimestamp(verdictIssuedAt);
  const parts = [String(releaseId), String(effectType), String(verdictStatus), timestamp];
  if (occurrence) parts.push(`at:${normalizeTimestamp(occurrence)}`);
  return parts.join(":");
}

/**
 * Writes all intended post-verdict deliveries in the caller's verdict
 * transaction. Shadow mode records intent only; legacy delivery stays active.
 * The enqueue mode is stored on the row and decides how the worker handles it,
 * so switching OUTBOX_MODE never re-sends shadow rows or drops primary rows.
 * `occurrence` distinguishes a repeated verdict with the same status (a
 * re-evaluation) so primary delivery does not drop it as a duplicate.
 */
async function enqueuePostVerdictOutbox({
  tx,
  releaseId,
  workspaceId,
  verdictStatus,
  verdictIssuedAt,
  triggerSource,
  source = "verdict",
  failedSignals = [],
  mode = OUTBOX_MODE,
  effectTypes = POST_VERDICT_EFFECT_TYPES,
  occurrence = null
}) {
  if (mode === "off") {
    return { mode, attempted: 0, inserted: [], duplicate_count: 0 };
  }
  if (mode !== "shadow" && mode !== "primary") throw new Error(`unsupported outbox mode: ${mode}`);
  if (!tx || typeof tx.run !== "function") {
    throw new Error("outbox enqueue requires an active transaction");
  }
  if (!releaseId || !workspaceId || !verdictStatus) {
    throw new Error("outbox enqueue requires release, workspace, and verdict status");
  }

  const issuedAt = normalizeTimestamp(verdictIssuedAt);
  const envelope = {
    schema_version: 1,
    mode,
    trigger_source: String(triggerSource || "verdict_engine"),
    failed_signals: Array.isArray(failedSignals) ? failedSignals : []
  };
  const keyOccurrence = mode === "primary" ? occurrence : null;
  const rows = [...new Set(effectTypes)].map((effectType) => ({
    id: `oeo_${crypto.randomUUID().replace(/-/g, "")}`,
    workspace_id: String(workspaceId),
    release_id: String(releaseId),
    effect_type: String(effectType),
    source: String(source || "verdict"),
    verdict_status: String(verdictStatus),
    verdict_issued_at: issuedAt,
    idempotency_key: buildOutboxIdempotencyKey({
      releaseId,
      effectType,
      verdictStatus,
      verdictIssuedAt: issuedAt,
      occurrence: keyOccurrence
    }),
    envelope_json: envelope
  }));

  if (rows.length === 0) {
    return { mode, attempted: 0, inserted: [], duplicate_count: 0 };
  }

  const result = await tx.run(
    `INSERT INTO outbound_effect_outbox
       (id, workspace_id, release_id, effect_type, source, verdict_status,
        verdict_issued_at, idempotency_key, envelope_json)
     SELECT
       item.id,
       item.workspace_id,
       item.release_id,
       item.effect_type,
       item.source,
       item.verdict_status,
       item.verdict_issued_at::timestamptz,
       item.idempotency_key,
       item.envelope_json
     FROM jsonb_to_recordset($1::jsonb) AS item(
       id text,
       workspace_id text,
       release_id text,
       effect_type text,
       source text,
       verdict_status text,
       verdict_issued_at text,
       idempotency_key text,
       envelope_json jsonb
     )
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id, effect_type, idempotency_key`,
    [JSON.stringify(rows)]
  );

  const inserted = result.rows || [];
  return {
    mode,
    attempted: rows.length,
    inserted,
    duplicate_count: rows.length - inserted.length
  };
}

module.exports = {
  POST_VERDICT_EFFECT_TYPES,
  buildOutboxIdempotencyKey,
  enqueuePostVerdictOutbox
};
