"use strict";

const { writeAudit } = require("./audit");
const { computeReleaseTrajectory } = require("./gateTrajectory");
const { getMissingRequiredSignals, getLatestSignalMap } = require("./verdictEngine");
const { computeGateAction, computeCollectionAgeMs } = require("./releaseIdentity");
const { getWorkspacePolicy, getThresholdMap } = require("./workspaceConfig");
const { getReleaseIntelligence, computeVerdict } = require("./domain");
const { buildGateBlockers } = require("./gateBlockers");
const { buildGateRemediation } = require("./gateRemediation");
const { buildGateCertification } = require("./gateCertification");

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

  const [policy, intelligence, thresholdMap, trajectoryInfo, latest] = await Promise.all([
    getWorkspacePolicy(release.workspace_id),
    getReleaseIntelligence(releaseId),
    getThresholdMap(release.workspace_id),
    computeReleaseTrajectory({
      workspaceId: release.workspace_id,
      releaseId,
      releaseRow: release
    }),
    getLatestSignalMap(releaseId)
  ]);

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

  const failedSignalsFromIntel = intelligence?.verdict?.failed_signals ?? [];
  let failedSignals = failedSignalsFromIntel;
  if (!failedSignals.length && (release.status === "UNCERTIFIED" || release.status === "CERTIFIED_WITH_OVERRIDE")) {
    const verdict = await computeVerdict(release.workspace_id, releaseId, latest, release, thresholdMap);
    failedSignals = verdict.failed_signals ?? [];
  }
  const blockingSignals = failedSignals.map((f) => f.signal_id).filter(Boolean);
  const missingRequiredSignals = await getMissingRequiredSignals(
    release.workspace_id,
    releaseId,
    latest,
    release,
    thresholdMap
  );
  const collectionAgeMs = computeCollectionAgeMs(release);
  const action = computeGateAction({
    status: release.status,
    gateAllowed,
    blockingSignals,
    missingRequiredSignals,
    collectionAgeMs
  });

  const { blockers, next_step: nextStep } = buildGateBlockers({
    status: release.status,
    mode,
    gateAllowed,
    gateReason,
    blockingSignals,
    missingRequiredSignals,
    failedSignals
  });

  const remediation =
    !gateAllowed || release.status === "COLLECTING"
      ? await buildGateRemediation({
          release,
          intelligence,
          failedSignals,
          thresholdMap,
          latest,
          missingRequiredSignals
        })
      : null;

  const certification = gateAllowed
    ? await buildGateCertification({
        release,
        intelligence,
        thresholdMap,
        latest,
        missingRequiredSignals
      })
    : null;

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
    blockers,
    next_step: nextStep,
    remediation,
    certification,
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
