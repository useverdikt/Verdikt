"use strict";

const crypto = require("crypto");
const { queryOne, run } = require("../database");
const { nowIso } = require("../lib/time");

function sortDeep(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.keys(value)
    .sort()
    .reduce((acc, key) => {
      acc[key] = sortDeep(value[key]);
      return acc;
    }, {});
}

function stableJson(value) {
  return JSON.stringify(sortDeep(value));
}

/**
 * SHA-256 over frozen threshold + signal maps at verdict time.
 */
function computeEvidenceHash(thresholdMap = {}, signalMap = {}) {
  const canonical = stableJson({
    thresholds: thresholdMap,
    signals: signalMap
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

/**
 * Persist verdict-time evidence. First write wins unless allowUpdate (override path).
 */
async function persistCertificationSnapshot({
  releaseId,
  workspaceId,
  thresholdMap,
  signalMap,
  status,
  allowUpdate = false
}) {
  const evidenceHash = computeEvidenceHash(thresholdMap, signalMap);
  const frozenAt = nowIso();
  const statusAtVerdict = String(status || "").toUpperCase();

  if (allowUpdate) {
    await run(
      `INSERT INTO certification_snapshots
         (release_id, workspace_id, status_at_verdict, threshold_snapshot_json, signal_snapshot_json, evidence_hash, frozen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(release_id) DO UPDATE SET
         status_at_verdict = excluded.status_at_verdict,
         threshold_snapshot_json = excluded.threshold_snapshot_json,
         signal_snapshot_json = excluded.signal_snapshot_json,
         evidence_hash = excluded.evidence_hash,
         frozen_at = excluded.frozen_at`,
      [
        releaseId,
        workspaceId,
        statusAtVerdict,
        JSON.stringify(thresholdMap || {}),
        JSON.stringify(signalMap || {}),
        evidenceHash,
        frozenAt
      ]
    );
  } else {
    await run(
      `INSERT INTO certification_snapshots
         (release_id, workspace_id, status_at_verdict, threshold_snapshot_json, signal_snapshot_json, evidence_hash, frozen_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(release_id) DO NOTHING`,
      [
        releaseId,
        workspaceId,
        statusAtVerdict,
        JSON.stringify(thresholdMap || {}),
        JSON.stringify(signalMap || {}),
        evidenceHash,
        frozenAt
      ]
    );
  }

  return { evidence_hash: evidenceHash, frozen_at: frozenAt };
}

async function getCertificationSnapshot(releaseId) {
  const row = await queryOne("SELECT * FROM certification_snapshots WHERE release_id = ?", [releaseId]);
  if (!row) return null;
  let threshold_map = {};
  let signal_map = {};
  try {
    threshold_map = JSON.parse(row.threshold_snapshot_json || "{}");
  } catch {
    threshold_map = {};
  }
  try {
    signal_map = JSON.parse(row.signal_snapshot_json || "{}");
  } catch {
    signal_map = {};
  }
  return {
    release_id: row.release_id,
    workspace_id: row.workspace_id,
    status_at_verdict: row.status_at_verdict,
    threshold_map,
    signal_map,
    evidence_hash: row.evidence_hash,
    frozen_at: row.frozen_at
  };
}

module.exports = {
  computeEvidenceHash,
  persistCertificationSnapshot,
  getCertificationSnapshot
};
