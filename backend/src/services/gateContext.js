"use strict";

/**
 * gateContext.js
 *
 * Single entry point for building gate-context objects (certification / remediation).
 * Prefers frozen verdict-time snapshots when available.
 */

const { getThresholdMap } = require("./workspaceConfig");
const { getLatestSignalMap, getMissingRequiredSignals } = require("./verdictEngine");
const { getCertificationSnapshot } = require("./certificationSnapshots");
const { buildGateCertification } = require("./gateCertification");
const { buildGateRemediation } = require("./gateRemediation");
const { log, inc } = require("../lib/observability");
const { CERT_LIKE, BLOCKED_OR_COLLECTING } = require("../lib/releaseStatus");

async function resolveGateEvidence(release) {
  const snapshot = await getCertificationSnapshot(release.id);
  if (snapshot) {
    return {
      thresholdMap: snapshot.threshold_map || {},
      latest: snapshot.signal_map || {},
      snapshot
    };
  }

  const [thresholdMap, latest] = await Promise.all([
    getThresholdMap(release.workspace_id),
    getLatestSignalMap(release.id)
  ]);
  return { thresholdMap, latest, snapshot: null };
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
  const missingRequiredSignals = await getMissingRequiredSignals(
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
      if (certification && snapshot) {
        certification.frozen_at = snapshot.frozen_at;
        certification.evidence_hash = snapshot.evidence_hash;
      }
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
      if (remediation && snapshot) {
        remediation.frozen_at = snapshot.frozen_at;
        remediation.evidence_hash = snapshot.evidence_hash;
      }
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

module.exports = { buildGateContext, resolveGateEvidence };
