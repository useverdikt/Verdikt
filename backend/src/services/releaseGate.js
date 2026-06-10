"use strict";

const { writeAudit } = require("./audit");
const { computeReleaseTrajectory } = require("./gateTrajectory");
const { getMissingRequiredSignals } = require("./verdictEngine");
const { computeGateAction } = require("./releaseIdentity");
const { getWorkspacePolicy } = require("./workspaceConfig");
const { getReleaseIntelligence } = require("./domain");

/**
 * Build the standard release gate payload (used by release_id and commit_sha routes).
 */
async function buildReleaseGateResponse(release, { mode: modeOverride, auth } = {}) {
  const releaseId = release.id;
  const allowStatuses = new Set(["CERTIFIED", "CERTIFIED_WITH_OVERRIDE"]);
  const allowed = allowStatuses.has(release.status);
  const reasonByStatus = {
    COLLECTING: "release still collecting required signals",
    UNCERTIFIED: "release is uncertified",
    CERTIFIED: "release certified",
    CERTIFIED_WITH_OVERRIDE: "release certified with override"
  };
  const reason = reasonByStatus[release.status] || `release status is ${release.status}`;
  const policy = await getWorkspacePolicy(release.workspace_id);
  const mode =
    modeOverride === "strict"
      ? "strict"
      : modeOverride === "default"
        ? "default"
        : policy?.gate_mode === "strict"
          ? "strict"
          : "default";
  const strictAllowed = release.status === "CERTIFIED";
  const gateAllowed = mode === "strict" ? strictAllowed : allowed;
  const gateReason =
    mode === "strict" && release.status === "CERTIFIED_WITH_OVERRIDE"
      ? "strict mode requires CERTIFIED without override"
      : reason;

  const intelligence = await getReleaseIntelligence(releaseId);
  const failedSignals = intelligence?.verdict?.failed_signals ?? [];
  const blockingSignals = failedSignals.map((f) => f.signal_id).filter(Boolean);
  const trajectoryInfo = await computeReleaseTrajectory({
    workspaceId: release.workspace_id,
    releaseId,
    releaseRow: release
  });
  const missingRequiredSignals = await getMissingRequiredSignals(
    release.workspace_id,
    releaseId,
    null,
    release
  );
  const action = computeGateAction({
    status: release.status,
    gateAllowed,
    blockingSignals,
    missingRequiredSignals
  });

  await writeAudit({
    workspaceId: release.workspace_id,
    releaseId,
    eventType: "RELEASE_GATE_CHECKED",
    actorType: auth?.authType === "api_key" ? "AGENT" : "SYSTEM",
    actorName: auth?.authType === "api_key" ? auth.apiKeyName || "agent_runtime" : "ci_pipeline",
    details: {
      mode,
      allowed: gateAllowed,
      status: release.status,
      reason: gateReason,
      trajectory: trajectoryInfo.trajectory,
      action,
      commit_sha: release.commit_sha || null
    }
  });

  return {
    release_id: releaseId,
    workspace_id: release.workspace_id,
    commit_sha: release.commit_sha || null,
    pr_number: release.pr_number ?? null,
    status: release.status,
    mode,
    certified: allowed,
    can_merge: gateAllowed,
    action,
    blocking_signals: blockingSignals,
    missing_required_signals: missingRequiredSignals,
    gate: {
      allowed: gateAllowed,
      reason: gateReason,
      exit_code: gateAllowed ? 0 : 1,
      trajectory: trajectoryInfo.trajectory,
      degrading_signals: trajectoryInfo.degrading_signals,
      improving_signals: trajectoryInfo.improving_signals,
      trend_note: trajectoryInfo.trend_note
    }
  };
}

module.exports = { buildReleaseGateResponse };
