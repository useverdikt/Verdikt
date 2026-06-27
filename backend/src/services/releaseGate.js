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
const { buildGateCalibrationContext } = require("./gateCalibrationContext");
const { getWorkspaceRemediationDebt } = require("./remediationDebt");
const { getWorkspaceIncidentCorroboration } = require("./incidentContext");
const { isEmergencyReleaseType } = require("../lib/emergencyReleaseType");

/**
 * Build the standard release gate payload (used by release_id and commit_sha routes).
 */
async function buildReleaseGateResponse(release, { mode: modeOverride, auth, skipAudit = false } = {}) {
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

  const [policy, intelligence, thresholdMap, trajectoryInfo, latest, remediationDebt] = await Promise.all([
    getWorkspacePolicy(release.workspace_id),
    getReleaseIntelligence(releaseId),
    getThresholdMap(release.workspace_id),
    computeReleaseTrajectory({
      workspaceId: release.workspace_id,
      releaseId,
      releaseRow: release
    }),
    getLatestSignalMap(releaseId),
    getWorkspaceRemediationDebt(release.workspace_id)
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
  let gateAllowed = mode === "strict" ? strictAllowed : allowed;
  let gateReason =
    mode === "strict" && release.status === "CERTIFIED_WITH_OVERRIDE"
      ? "strict mode requires CERTIFIED without override"
      : reason;

  // Remediation debt: after an emergency merge without certification, the
  // workspace must clear the debt with a clean CERTIFIED release before
  // non-emergency merges can proceed via override or bypass. Emergency
  // releases (e.g. incident_hotfix) are exempt so teams can keep fighting a
  // live incident without being blocked by the circuit breaker.
  const isEmergencyRelease = isEmergencyReleaseType(release.release_type);
  const incidentCorroboration = isEmergencyRelease
    ? await getWorkspaceIncidentCorroboration(release.workspace_id)
    : null;

  // Strict mode normally requires CERTIFIED without override; emergency hotfixes
  // with corroborated incident context may still merge on override.
  if (
    mode === "strict" &&
    release.status === "CERTIFIED_WITH_OVERRIDE" &&
    isEmergencyRelease &&
    incidentCorroboration?.eligible
  ) {
    gateAllowed = true;
    gateReason = reason;
  }

  let blockedByRemediationDebt = false;
  if (remediationDebt.active && !isEmergencyRelease && release.status !== "CERTIFIED") {
    gateAllowed = false;
    gateReason = remediationDebt.message;
    blockedByRemediationDebt = true;
  }

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
    collectionAgeMs,
    blockedByRemediationDebt
  });

  const { blockers, next_step: nextStep } = buildGateBlockers({
    status: release.status,
    mode,
    gateAllowed,
    gateReason,
    blockingSignals,
    missingRequiredSignals,
    failedSignals,
    remediationDebt,
    isEmergencyRelease
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

  let calibration = null;
  try {
    calibration = await buildGateCalibrationContext(release.workspace_id);
  } catch (err) {
    console.error("[gate_calibration] context build failed:", release.workspace_id, err?.message);
  }

  if (!skipAudit) {
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
  }

  return {
    release_id: releaseId,
    workspace_id: release.workspace_id,
    commit_sha: release.commit_sha || null,
    pr_number: release.pr_number ?? null,
    release_type: release.release_type || null,
    status: release.status,
    mode,
    certified: allowed,
    can_merge: gateAllowed,
    action,
    emergency_release: isEmergencyRelease,
    remediation_debt_exempt: isEmergencyRelease && remediationDebt.active,
    incident_corroborated: incidentCorroboration?.eligible ?? null,
    blocking_signals: blockingSignals,
    missing_required_signals: missingRequiredSignals,
    blockers,
    next_step: nextStep,
    remediation,
    certification,
    calibration,
    remediation_debt: remediationDebt,
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
