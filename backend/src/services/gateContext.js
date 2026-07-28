"use strict";

/**
 * gateContext.js
 *
 * Single entry point for building gate-context objects (certification / remediation)
 * and for resolving the threshold/signal evidence maps used by the gate.
 * Prefers frozen verdict-time snapshots when available.
 */

const workspaceConfig = require("./workspaceConfig");
const verdictEngine = require("./verdictEngine");
const certificationSnapshots = require("./certificationSnapshots");
const { buildGateCertification } = require("./gateCertification");
const { buildGateRemediation } = require("./gateRemediation");
const { log, inc } = require("../lib/observability");
const { CERT_LIKE, BLOCKED_OR_COLLECTING } = require("../lib/releaseStatus");

/**
 * Resolve threshold + signal maps for gate / cert / remediation builders.
 * Certified releases with a snapshot use frozen maps; everyone else uses live maps.
 * Callers that block on missing cert snapshots should use {@link isCertifiedSnapshotMissing}.
 *
 * @returns {Promise<{ thresholdMap: object, latest: object, snapshot: object|null, source: "snapshot"|"live" }>}
 */
async function resolveGateEvidence(release) {
  const snapshot = await certificationSnapshots.getCertificationSnapshot(release.id);
  if (snapshot) {
    return {
      thresholdMap: snapshot.threshold_map || {},
      latest: snapshot.signal_map || {},
      snapshot,
      source: "snapshot"
    };
  }

  const [thresholdMap, latest] = await Promise.all([
    workspaceConfig.getThresholdMap(release.workspace_id),
    verdictEngine.getLatestSignalMap(release.id)
  ]);
  return { thresholdMap, latest, snapshot: null, source: "live" };
}

/**
 * True when a CERTIFIED* release has no frozen snapshot — gate must block merge
 * (recover_certification) even though live maps may still be loaded for blockers.
 */
function isCertifiedSnapshotMissing(release, evidence) {
  const status = String(release?.status || "").toUpperCase();
  const isCertified = status === "CERTIFIED" || status === "CERTIFIED_WITH_OVERRIDE";
  return isCertified && !evidence?.snapshot;
}

function attachSnapshotMeta(payload, snapshot) {
  if (!payload || !snapshot) return payload;
  payload.frozen_at = snapshot.frozen_at;
  payload.evidence_hash = snapshot.evidence_hash;
  return payload;
}

/**
 * Build the gate-context objects for a release that already has a verdict.
 */
async function buildGateContext(release, intelligence) {
  const status = String(release.status || "").toUpperCase();

  // Fetch evidence first. Any failure here must propagate so callers fail closed
  // rather than acting on an empty context (e.g., showing a certified release as
  // clean because thresholds and signals could not be loaded).
  const { thresholdMap, latest, snapshot } = await resolveGateEvidence(release);
  const missingRequiredSignals = await verdictEngine.getMissingRequiredSignals(
    release.workspace_id,
    release.id,
    latest,
    release,
    thresholdMap
  );

  const shared = { release, intelligence, thresholdMap, latest, missingRequiredSignals };

  let certification = null;
  if (CERT_LIKE.has(status)) {
    try {
      certification = await buildGateCertification(shared);
      attachSnapshotMeta(certification, snapshot);
    } catch (err) {
      inc("gate_context_certification_build_failed");
      log("error", "gate_context_certification_build_failed", {
        releaseId: release.id,
        error: err?.message
      });
    }
  }

  let remediation = null;
  if (BLOCKED_OR_COLLECTING.has(status)) {
    try {
      remediation = await buildGateRemediation({
        ...shared,
        failedSignals: []
      });
      attachSnapshotMeta(remediation, snapshot);
    } catch (err) {
      inc("gate_context_remediation_build_failed");
      log("error", "gate_context_remediation_build_failed", {
        releaseId: release.id,
        error: err?.message
      });
    }
  }

  return { certification, remediation, snapshot };
}

module.exports = {
  buildGateContext,
  resolveGateEvidence,
  isCertifiedSnapshotMissing,
  attachSnapshotMeta
};
