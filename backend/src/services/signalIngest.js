"use strict";

const { nowIso } = require("../lib/time");
const { transaction } = require("../database");
const { writeAudit } = require("./audit");
const { evaluateReleaseAfterSignalIngest } = require("./domain");
const {
  extractIdempotencyKey,
  countSignalsForIdempotencyKey,
  respondToDuplicateSignalIngest
} = require("./signalIngestIdempotency");

// ON CONFLICT DO NOTHING ensures duplicate signal rows from concurrent
// requests with the same idempotency key are silently discarded at the DB level.
// RETURNING id lets us detect the race-loser (concurrent first-time requests
// that both passed the route-level pre-check) so we can short-circuit to a
// read-only replay and skip the downstream audit + verdict re-evaluation.
const INSERT_SIGNALS_SQL =
  "INSERT INTO signals (release_id, signal_id, value, source, created_at, idempotency_key) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING RETURNING id";

async function ingestIntegrationSignals({
  release,
  mappedSignals,
  source,
  idempotencyKey = null,
  auditDetails = {}
}) {
  const signalIds = Object.keys(mappedSignals || {});
  if (!signalIds.length) {
    throw new Error("no supported numeric signals found in payload");
  }

  // Fast path: if the route already confirmed a duplicate via its pre-check
  // (countSignalsForIdempotencyKey), replay read-only without opening a
  // transaction. The transaction + ON CONFLICT below is the race backstop for
  // the narrow window where two concurrent first-time requests both pass that
  // pre-check.
  if (idempotencyKey) {
    const existingCount = await countSignalsForIdempotencyKey(release.id, idempotencyKey);
    if (existingCount > 0) {
      const out = await respondToDuplicateSignalIngest(release, release.id, source, idempotencyKey);
      return { ...out, inserted_count: 0, duplicate: true };
    }
  }

  let insertedCount = 0;
  await transaction(async (tx) => {
    for (const [signalId, value] of Object.entries(mappedSignals)) {
      const result = await tx.query(INSERT_SIGNALS_SQL, [release.id, signalId, value, source, nowIso(), idempotencyKey]);
      if (result.rows?.length > 0) insertedCount += 1;
    }
  });

  // Race-loser: a concurrent request with the same idempotency key won the
  // insert; our ON CONFLICT DO NOTHING inserts produced no rows. Replay
  // read-only — do NOT write a second audit event or re-evaluate the verdict.
  if (idempotencyKey && insertedCount === 0) {
    const out = await respondToDuplicateSignalIngest(release, release.id, source, idempotencyKey);
    return { ...out, inserted_count: 0, duplicate: true };
  }

  await writeAudit({
    workspaceId: release.workspace_id,
    releaseId: release.id,
    eventType: "INTEGRATION_SIGNALS_MAPPED",
    actorType: "SYSTEM",
    actorName: source,
    details: {
      mapped_signal_ids: signalIds,
      ...auditDetails
    }
  });

  const out = await evaluateReleaseAfterSignalIngest(release, release.id, source, signalIds.length);
  if (idempotencyKey) out.idempotency_key = idempotencyKey;
  return { ...out, inserted_count: signalIds.length };
}

function resolveIntegrationIdempotencyKey(req, fallbackKeys = []) {
  return extractIdempotencyKey(req, fallbackKeys);
}

module.exports = { ingestIntegrationSignals, resolveIntegrationIdempotencyKey };
