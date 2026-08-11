"use strict";

const { nowIso } = require("../lib/time");
const { transaction } = require("../database");
const { writeAudit } = require("./audit");
const { evaluateReleaseAfterSignalIngest } = require("./domain");
const {
  extractIdempotencyKey,
  respondToDuplicateSignalIngest,
  replayDuplicateSignalIngestIfPresent
} = require("./signalIngestIdempotency");

// ON CONFLICT DO NOTHING ensures duplicate signal rows from concurrent
// requests with the same idempotency key are silently discarded at the DB level.
// RETURNING id lets us detect the race-loser (concurrent first-time requests
// that both passed the route-level pre-check) so we can short-circuit to a
// read-only replay and skip the downstream audit + verdict re-evaluation.
const INSERT_SIGNALS_SQL =
  "INSERT INTO signals (release_id, signal_id, value, source, created_at, idempotency_key) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING RETURNING id";

/**
 * Shared persistence and evaluation path for release signals. Route-specific
 * authentication, lock errors, payload shape, and response decoration remain
 * at the boundary.
 */
async function ingestReleaseSignals({
  release,
  signals,
  source,
  idempotencyKey = null,
  validateSignal = null,
  beforeEvaluate = null
}) {
  const entries = Object.entries(signals || {});
  const duplicateResponse = await replayDuplicateSignalIngestIfPresent(
    release,
    source,
    idempotencyKey
  );
  if (duplicateResponse) {
    return {
      kind: "duplicate",
      response: duplicateResponse,
      insertedCount: 0,
      acceptedSignalIds: [],
      rejectedSignalIds: []
    };
  }

  const acceptedEntries = [];
  const rejectedSignalIds = [];
  for (const [signalId, value] of entries) {
    if (validateSignal && !validateSignal(signalId, value)) {
      rejectedSignalIds.push(signalId);
    } else {
      acceptedEntries.push([signalId, value]);
    }
  }

  let insertedCount = 0;
  if (acceptedEntries.length > 0) {
    await transaction(async (tx) => {
      for (const [signalId, value] of acceptedEntries) {
        const result = await tx.query(INSERT_SIGNALS_SQL, [
          release.id,
          signalId,
          value,
          source,
          nowIso(),
          idempotencyKey
        ]);
        if (result.rows?.length > 0) insertedCount += 1;
      }
    });
  }

  if (entries.length > 0 && insertedCount === 0) {
    if (idempotencyKey && rejectedSignalIds.length < entries.length) {
      const response = await respondToDuplicateSignalIngest(
        release,
        release.id,
        source,
        idempotencyKey
      );
      return {
        kind: "duplicate",
        response,
        insertedCount: 0,
        acceptedSignalIds: acceptedEntries.map(([signalId]) => signalId),
        rejectedSignalIds
      };
    }
    return {
      kind: "no_valid_signals",
      response: null,
      insertedCount: 0,
      acceptedSignalIds: [],
      rejectedSignalIds
    };
  }

  const acceptedSignalIds = acceptedEntries.map(([signalId]) => signalId);
  if (beforeEvaluate) {
    await beforeEvaluate({
      acceptedSignalIds,
      rejectedSignalIds,
      insertedCount
    });
  }
  const response = await evaluateReleaseAfterSignalIngest(
    release,
    release.id,
    source,
    insertedCount
  );
  if (idempotencyKey && response) response.idempotency_key = idempotencyKey;
  return {
    kind: "ingested",
    response,
    insertedCount,
    acceptedSignalIds,
    rejectedSignalIds
  };
}

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

  const result = await ingestReleaseSignals({
    release,
    signals: mappedSignals,
    source,
    idempotencyKey,
    beforeEvaluate: async () => {
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
    }
  });
  return {
    ...result.response,
    inserted_count: result.kind === "duplicate" ? 0 : signalIds.length,
    ...(result.kind === "duplicate" ? { duplicate: true } : {})
  };
}

function resolveIntegrationIdempotencyKey(req, fallbackKeys = []) {
  return extractIdempotencyKey(req, fallbackKeys);
}

module.exports = {
  ingestReleaseSignals,
  ingestIntegrationSignals,
  resolveIntegrationIdempotencyKey
};
