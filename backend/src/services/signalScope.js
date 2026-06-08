"use strict";

/**
 * Which thresholded signals are required for a release depends on:
 *   1. Connected signal integrations (source → signal map in shared config)
 *   2. Release-type waivers (e.g. e2e_regression optional for model_patch)
 */

const { queryAll } = require("../database");
const sharedPkg = require("../lib/sharedPkg");

async function getConnectedSourceIds(workspaceId) {
  const rows = await queryAll(
    "SELECT source_id FROM signal_integrations WHERE workspace_id = ?",
    [workspaceId]
  );
  return new Set(rows.map((r) => String(r.source_id || "")).filter(Boolean));
}

async function getInScopeSignalIds(workspaceId) {
  const connected = await getConnectedSourceIds(workspaceId);
  const scoped = new Set();
  for (const sourceId of connected) {
    for (const signalId of sharedPkg.getSignalsForSource(sourceId)) {
      scoped.add(signalId);
    }
  }
  return scoped;
}

function isE2eRegressionWaived(releaseRow) {
  if (!releaseRow) return false;
  const reqd = sharedPkg.getRegressionRequiredForReleaseType(releaseRow.release_type);
  return reqd === false;
}

/**
 * Whether a missing signal should block certification for this release.
 * Delta keys are never "required" as ingest targets (handled by delta engine).
 */
function isSignalRequiredForRelease(signalId, { inScopeIds, releaseRow }) {
  const id = String(signalId || "");
  if (!id || id.endsWith("_delta")) return false;
  if (!inScopeIds || !inScopeIds.has(id)) return false;
  if (id === "e2e_regression" && isE2eRegressionWaived(releaseRow)) return false;
  return true;
}

module.exports = {
  getConnectedSourceIds,
  getInScopeSignalIds,
  isE2eRegressionWaived,
  isSignalRequiredForRelease
};
