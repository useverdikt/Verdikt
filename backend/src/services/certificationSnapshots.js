"use strict";

const { queryOne, run } = require("../database");
const { nowIso } = require("../lib/time");
const { computeEvidenceHash } = require("@useverdikt/shared/verdictEngine");

/**
 * Persist verdict-time evidence. The first cert-like snapshot is frozen; a later
 * verdict replaces an earlier non-cert-like one (a pre-prod UNCERTIFIED release
 * re-evaluated to CERTIFIED must freeze the certifying evidence). allowUpdate
 * (override path) always replaces.
 */
async function persistCertificationSnapshot({
  releaseId,
  workspaceId,
  thresholdMap,
  signalMap,
  status,
  allowUpdate = false,
  tx = null
}) {
  const runFn = tx ? (sql, params) => tx.run(sql, params) : run;
  const evidenceHash = computeEvidenceHash(thresholdMap, signalMap);
  const frozenAt = nowIso();
  const statusAtVerdict = String(status || "").toUpperCase();

  if (allowUpdate) {
    await runFn(
      `INSERT INTO certification_snapshots
         (release_id, workspace_id, status_at_verdict, threshold_snapshot_json, signal_snapshot_json, evidence_hash, frozen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
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
    await runFn(
      `INSERT INTO certification_snapshots
         (release_id, workspace_id, status_at_verdict, threshold_snapshot_json, signal_snapshot_json, evidence_hash, frozen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT(release_id) DO UPDATE SET
         status_at_verdict = excluded.status_at_verdict,
         threshold_snapshot_json = excluded.threshold_snapshot_json,
         signal_snapshot_json = excluded.signal_snapshot_json,
         evidence_hash = excluded.evidence_hash,
         frozen_at = excluded.frozen_at
       WHERE certification_snapshots.status_at_verdict NOT IN ('CERTIFIED', 'CERTIFIED_WITH_OVERRIDE')`,
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
  const row = await queryOne("SELECT * FROM certification_snapshots WHERE release_id = $1", [releaseId]);
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
