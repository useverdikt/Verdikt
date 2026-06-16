"use strict";

/**
 * gateContext.js
 *
 * Single entry point for building gate-context objects (certification / remediation).
 * Handles the shared boilerplate of fetching thresholdMap + latest + missingRequired
 * before delegating to the appropriate builder.
 *
 * Called by:
 *   - releaseDetail.js  (detail API — cert record UI)
 *   - postVerdictEffects.js  (webhook / callback delivery)
 *
 * releaseGate.js already owns all inputs at call time, so it calls the builders
 * directly to avoid a redundant fetch round-trip.
 */

const { getThresholdMap } = require("./workspaceConfig");
const { getLatestSignalMap, getMissingRequiredSignals } = require("./verdictEngine");
const { buildGateCertification } = require("./gateCertification");
const { buildGateRemediation } = require("./gateRemediation");

const CERT_LIKE = new Set(["CERTIFIED", "CERTIFIED_WITH_OVERRIDE"]);
const BLOCKED_OR_COLLECTING = new Set(["UNCERTIFIED", "COLLECTING"]);

/**
 * Build the gate-context objects for a release that already has a verdict.
 *
 * Returns `{ certification, remediation }` — one of the two is always null.
 * Safe to call from any post-verdict context; errors in each builder are caught
 * individually so a failure in one does not suppress the other.
 *
 * @param {object} release     – release row from the database
 * @param {object} intelligence – result of getReleaseIntelligence(), may be null
 * @returns {Promise<{ certification: object|null, remediation: object|null }>}
 */
async function buildGateContext(release, intelligence) {
  const status = String(release.status || "").toUpperCase();

  let thresholdMap = {};
  let latest = {};
  let missingRequiredSignals = [];

  try {
    [thresholdMap, latest] = await Promise.all([
      getThresholdMap(release.workspace_id),
      getLatestSignalMap(release.id)
    ]);
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
    } catch (err) {
      console.error("[gate_context] remediation build failed for", release.id, err?.message);
    }
  }

  return { certification, remediation };
}

module.exports = { buildGateContext };
