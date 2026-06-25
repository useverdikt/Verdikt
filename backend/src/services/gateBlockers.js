"use strict";

/**
 * Machine-readable blockers for gate / MCP responses so agents and humans
 * know exactly why a release is blocked and what to do next.
 */
function buildGateBlockers({
  status,
  mode,
  gateAllowed,
  gateReason,
  blockingSignals = [],
  missingRequiredSignals = [],
  failedSignals = [],
  remediationDebt = null,
  isEmergencyRelease = false
}) {
  if (gateAllowed) {
    return {
      blockers: [],
      next_step: "Merge or deploy — gate passed for the current mode."
    };
  }

  const blockers = [];
  const seen = new Set();

  const push = (blocker) => {
    const key = `${blocker.type}:${blocker.signal_id || blocker.code || blocker.message || ""}`;
    if (seen.has(key)) return;
    seen.add(key);
    blockers.push(blocker);
  };

  if (status === "COLLECTING") {
    push({
      type: "collecting",
      code: "release_collecting",
      message: gateReason || "Release is still collecting required signals.",
      next_step:
        "Apply verdikt:rc on the PR (or create_release with commit_sha), connect signal sources in Settings, ensure eval runs are tagged with the PR head SHA, then check gate again."
    });
  }

  for (const signalId of missingRequiredSignals || []) {
    if (!signalId) continue;
    push({
      type: "missing_signal",
      signal_id: signalId,
      message: `Required signal "${signalId}" has no value yet.`,
      next_step:
        "Connect the integration for this signal in Settings → Signal sources, verify SHA tagging on the PR head commit, or POST the signal via API/MCP post_signals."
    });
  }

  for (const failure of failedSignals || []) {
    const signalId = failure?.signal_id;
    if (!signalId) continue;
    const rule = failure.rule ? String(failure.rule) : null;
    push({
      type: "threshold_failed",
      signal_id: signalId,
      value: failure.value ?? null,
      rule,
      failure_kind: failure.failure_kind || null,
      message: rule
        ? `Signal "${signalId}" failed gate (${rule}).`
        : `Signal "${signalId}" failed quality gate.`,
      next_step:
        "Fix the underlying eval/monitoring issue, re-run CI or integration pull, then check gate again. Adjust thresholds in Settings → Thresholds only if the bar should change."
    });
  }

  if (
    remediationDebt?.active &&
    !isEmergencyRelease &&
    status !== "CERTIFIED" &&
    !gateAllowed
  ) {
    const version = remediationDebt.source_version || "prior release";
    push({
      type: "remediation_debt",
      code: "remediation_debt_active",
      source_release_id: remediationDebt.source_release_id || null,
      source_version: remediationDebt.source_version || null,
      since: remediationDebt.since || null,
      lookback_days: remediationDebt.lookback_days ?? null,
      message: `Remediation debt active from emergency merge without certification (${version}). Non-emergency merges are blocked until the bypass ages out.`,
      next_step:
        "Ship the next non-emergency release as CERTIFIED (no override/bypass). Emergency (incident_hotfix) releases are still allowed to fight a live incident."
    });
  }

  if (
    mode === "strict" &&
    status === "CERTIFIED_WITH_OVERRIDE" &&
    !gateAllowed
  ) {
    push({
      type: "strict_mode",
      code: "override_not_allowed_in_strict",
      message: "Strict gate mode requires CERTIFIED without override.",
      next_step:
        "Achieve a clean certification without override, or use default gate mode in Settings → Governance."
    });
  }

  if (
    status === "UNCERTIFIED" &&
    blockers.length === 0 &&
    (blockingSignals.length > 0 || gateReason)
  ) {
    push({
      type: "uncertified",
      code: "release_uncertified",
      message: gateReason || "Release is uncertified.",
      next_step:
        "Review failed signals, fix root cause or escalate to a human approver, then re-check gate."
    });
  }

  const nextStep =
    blockers.find((b) => b.next_step)?.next_step ||
    gateReason ||
    "Fix blocking issues and check gate again.";

  return { blockers, next_step: nextStep };
}

module.exports = { buildGateBlockers };
