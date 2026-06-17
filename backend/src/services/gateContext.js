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

const CERT_LIKE = new Set(["CERTIFIED", "CERTIFIED_WITH_OVERRIDE"]);
const BLOCKED_OR_COLLECTING = new Set(["UNCERTIFIED", "COLLECTING"]);

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

  let thresholdMap = {};
  let latest = {};
  let snapshot = null;
  let missingRequiredSignals = [];

  try {
    ({ thresholdMap, latest, snapshot } = await resolveGateEvidence(release));
    missingRequiredSignals = await getMissingRequiredSignals(
      release.workspace_id,
      release.id,
      latest,
      release,
      thresholdMap
    );
  } catch (err) {
    console.error("[gate_context] input fetch failed for", release.id, err?.message);
  }

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
      console.error("[gate_context] certification build failed for", release.id, err?.message);
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
      console.error("[gate_context] remediation build failed for", release.id, err?.message);
    }
  }

  return { certification, remediation, snapshot };
}

module.exports = { buildGateContext, resolveGateEvidence };
