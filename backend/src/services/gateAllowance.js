"use strict";

const { getWorkspacePolicy } = require("./workspaceConfig");
const { getWorkspaceRemediationDebt } = require("./remediationDebt");
const { getWorkspaceIncidentCorroboration } = require("./incidentContext");
const { isEmergencyReleaseType } = require("../lib/emergencyReleaseType");

function resolveGateMode(modeOverride, policy) {
  if (modeOverride === "strict" || modeOverride === "default") return modeOverride;
  return policy?.gate_mode === "strict" ? "strict" : "default";
}

/**
 * Whether the gate allows merge, from status and workspace policy. Shared by
 * the gate response and merge promotion so "shipped without certification"
 * means the same thing as a blocked gate.
 */
function computeGateAllowance({
  status,
  mode,
  isEmergencyRelease = false,
  incidentCorroborated = false,
  remediationDebtActive = false,
  snapshotMissing = false
}) {
  const certLike = status === "CERTIFIED" || status === "CERTIFIED_WITH_OVERRIDE";
  const strictBlocked =
    mode === "strict" &&
    status === "CERTIFIED_WITH_OVERRIDE" &&
    !(isEmergencyRelease && incidentCorroborated);
  const blockedByRemediationDebt = remediationDebtActive && !isEmergencyRelease && status !== "CERTIFIED";
  const gateAllowed = certLike && !strictBlocked && !blockedByRemediationDebt && !snapshotMissing;
  return { gateAllowed, strictBlocked, blockedByRemediationDebt };
}

/**
 * Policy view of the gate at merge time. The certification snapshot is left
 * out: a snapshot still being frozen is a transient evidence gap, not a merge
 * against policy, and must not open remediation debt.
 */
async function loadMergePolicyAllowance(release) {
  const isEmergencyRelease = isEmergencyReleaseType(release.release_type);
  const [policy, remediationDebt, incident] = await Promise.all([
    getWorkspacePolicy(release.workspace_id),
    getWorkspaceRemediationDebt(release.workspace_id),
    isEmergencyRelease ? getWorkspaceIncidentCorroboration(release.workspace_id) : null
  ]);
  const mode = resolveGateMode(null, policy);
  return {
    mode,
    ...computeGateAllowance({
      status: release.status,
      mode,
      isEmergencyRelease,
      incidentCorroborated: !!incident?.eligible,
      remediationDebtActive: !!remediationDebt?.active
    })
  };
}

module.exports = { resolveGateMode, computeGateAllowance, loadMergePolicyAllowance };
