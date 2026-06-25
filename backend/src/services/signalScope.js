"use strict";

/**
 * Which thresholded signals are required for a release depends on:
 *   1. required_for_certification flag on the threshold row (App → Thresholds)
 *   2. Connected signal integrations (source → signal map in shared config)
 */

const { queryAll } = require("../database");
const sharedPkg = require("../lib/sharedPkg");

async function getConnectedSourceIds(workspaceId) {
  const rows = await queryAll(
    "SELECT source_id FROM signal_integrations WHERE workspace_id = $1",
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
  // Manual QA has no external integration — always eligible when marked required.
  for (const signalId of sharedPkg.getSignalsForSource("manual_qa")) {
    scoped.add(signalId);
  }
  return scoped;
}

/**
 * Whether a missing signal should block certification for this release.
 * Delta keys are never "required" as ingest targets (handled by delta engine).
 * Required toggles in App → Thresholds gate certification regardless of integration connection.
 */
function isSignalRequiredForRelease(signalId, { thresholdMap }) {
  const id = String(signalId || "");
  if (!id || id.endsWith("_delta")) return false;
  const thr = thresholdMap?.[id];
  if (!thr?.required_for_certification) return false;
  return true;
}

module.exports = {
  getConnectedSourceIds,
  getInScopeSignalIds,
  isSignalRequiredForRelease
};
