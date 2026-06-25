"use strict";

const { queryOne } = require("../database");
const { AI_SIGNAL_IDS } = require("../config");
const { getThresholdMap } = require("./workspaceConfig");
const { getLatestSignalMap, getMissingRequiredSignals } = require("./verdictEngine");
const { listReleaseDeltas } = require("./delta");
const { getReleaseIntelligence } = require("./intelligenceBuilder");

function extractIdempotencyKey(req, fallbackKeys = []) {
  const header = req.headers?.["x-idempotency-key"];
  if (typeof header === "string" && header.trim()) return header.trim();
  const bodyKey = req.body?.idempotency_key;
  if (typeof bodyKey === "string" && bodyKey.trim()) return bodyKey.trim();
  for (const key of fallbackKeys) {
    if (typeof key === "string" && key.trim()) return key.trim();
  }
  return null;
}

async function countSignalsForIdempotencyKey(releaseId, idempotencyKey) {
  if (!idempotencyKey) return 0;
  const row = await queryOne(
    "SELECT COUNT(*) AS c FROM signals WHERE release_id = $1 AND idempotency_key = $2",
    [releaseId, idempotencyKey]
  );
  return Number(row?.c ?? 0);
}

async function loadLastIngestAuditDetails(releaseId) {
  const row = await queryOne(
    `SELECT details_json FROM audit_events
       WHERE release_id = $1 AND event_type = 'SIGNALS_INGESTED'
       ORDER BY id DESC LIMIT 1`,
    [releaseId]
  );
  if (!row) return {};
  try {
    return JSON.parse(row.details_json || "{}");
  } catch {
    return {};
  }
}

/** Read-only ingest response for duplicate idempotency keys — no verdict recompute or audit writes. */
async function buildIngestReadResponse(release, releaseId) {
  const fresh = (await queryOne("SELECT * FROM releases WHERE id = $1", [releaseId])) || release;
  const [latest, thresholdMap, deltas, intelligenceRow, auditDetails] = await Promise.all([
    getLatestSignalMap(releaseId),
    getThresholdMap(fresh.workspace_id),
    listReleaseDeltas(releaseId),
    getReleaseIntelligence(releaseId),
    loadLastIngestAuditDetails(releaseId)
  ]);
  const missingRequiredSignals = await getMissingRequiredSignals(
    fresh.workspace_id,
    releaseId,
    latest,
    fresh,
    thresholdMap
  );
  const missingAiSignals = missingRequiredSignals.filter((id) => AI_SIGNAL_IDS.includes(id));
  const missingNonAiSignals = missingRequiredSignals.filter((id) => !AI_SIGNAL_IDS.includes(id));
  const status = fresh.status;

  if (status === "COLLECTING") {
    return {
      release_id: releaseId,
      status,
      collection_deadline: fresh.collection_deadline,
      missing_required_signals: missingRequiredSignals,
      missing_ai_signals: missingAiSignals,
      missing_non_ai_signals: missingNonAiSignals,
      failed_signals: [],
      threshold_failed_signals: [],
      missing_signals: [],
      release_deltas: deltas,
      early_warning: auditDetails.early_warning,
      intelligence: intelligenceRow?.verdict ?? null,
      recommendation: null,
      assistive_enrichment_pending: false
    };
  }

  return {
    release_id: releaseId,
    status,
    missing_required_signals: missingRequiredSignals,
    missing_ai_signals: missingAiSignals,
    missing_non_ai_signals: missingNonAiSignals,
    threshold_failed_signals: Array.isArray(auditDetails.threshold_failed_signals)
      ? auditDetails.threshold_failed_signals
      : [],
    missing_signals: Array.isArray(auditDetails.missing_signals) ? auditDetails.missing_signals : [],
    failed_signals: Array.isArray(auditDetails.failed_signals) ? auditDetails.failed_signals : [],
    release_deltas: deltas,
    intelligence: intelligenceRow?.verdict ?? null,
    recommendation: null,
    assistive_enrichment_pending: false
  };
}

async function respondToDuplicateSignalIngest(release, releaseId, _source, idempotencyKey) {
  const out = await buildIngestReadResponse(release, releaseId);
  return { ...out, duplicate: true, idempotency_key: idempotencyKey };
}

module.exports = {
  extractIdempotencyKey,
  countSignalsForIdempotencyKey,
  buildIngestReadResponse,
  respondToDuplicateSignalIngest
};
