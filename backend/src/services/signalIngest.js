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

const INSERT_SIGNALS_SQL =
  "INSERT INTO signals (release_id, signal_id, value, source, created_at, idempotency_key) VALUES ($1, $2, $3, $4, $5, $6)";

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

  if (idempotencyKey) {
    const existingCount = await countSignalsForIdempotencyKey(release.id, idempotencyKey);
    if (existingCount > 0) {
      const out = await respondToDuplicateSignalIngest(release, release.id, source, idempotencyKey);
      return { ...out, inserted_count: 0, duplicate: true };
    }
  }

  await transaction(async (tx) => {
    for (const [signalId, value] of Object.entries(mappedSignals)) {
      await tx.run(INSERT_SIGNALS_SQL, [release.id, signalId, value, source, nowIso(), idempotencyKey]);
    }
  });

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
