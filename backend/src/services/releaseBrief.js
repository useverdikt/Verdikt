"use strict";

/**
 * releaseBrief.js
 *
 * Deterministic, read-only assembly of gate context for agents and humans.
 * No LLM — reuses buildReleaseGateResponse and shapes a single brief payload.
 */

const { PUBLIC_APP_URL } = require("../config");
const { writeAudit } = require("./audit");
const { buildReleaseGateResponse } = require("./releaseGate");

const BRIEF_VERSION = "deterministic_release_brief_v1";
const DEFAULT_APP_BASE = "https://useverdikt.com";

const NEXT_TOOL_BY_ACTION = {
  merge: null,
  collecting: "check_gate",
  self_heal: "check_gate",
  recover_certification: "check_gate",
  escalate: "escalate"
};

function appBaseUrl() {
  const base = (PUBLIC_APP_URL || DEFAULT_APP_BASE).trim();
  return base.replace(/\/$/, "") || DEFAULT_APP_BASE;
}

function buildHubLinks({ workspaceId }) {
  const base = appBaseUrl();
  return {
    releases: `${base}/releases`,
    escalations: `${base}/escalations`,
    thresholds: `${base}/thresholds`,
    intelligence_overview: `${base}/intelligence`,
    intelligence_alignment: `${base}/intelligence/alignment`,
    intelligence_correlations: `${base}/intelligence/correlations`,
    intelligence_overrides: `${base}/intelligence/overrides`,
    workspace_id: workspaceId
  };
}

function buildRegressionStory(remediation) {
  if (!remediation) {
    return {
      has_regression: false,
      summary: null,
      failures: [],
      baseline: null,
      regression_context: null
    };
  }

  const failures = (remediation.failures || []).filter(
    (f) => f.failure_kind === "regression" || f.regression_streak
  );
  const ctx = remediation.regression_context || null;
  const hasRegression =
    failures.length > 0 || !!(ctx && ctx.no_prior_certified_baseline !== true && ctx.baseline_release_id);

  let summary = null;
  if (ctx?.no_prior_certified_baseline) {
    summary =
      "No prior certified baseline yet; regression-from-baseline checks were skipped. Absolute thresholds still apply.";
  } else if (hasRegression) {
    const parts = [];
    for (const f of failures) {
      const streak = f.regression_streak?.consecutive_releases;
      if (streak >= 2) {
        parts.push(`${f.signal_id}: ${streak} consecutive regression releases`);
      } else if (f.failure_kind === "regression") {
        parts.push(`${f.signal_id}: regression vs certified baseline`);
      }
    }
    if (remediation.last_passing_baseline?.version) {
      parts.push(`Last passing baseline: ${remediation.last_passing_baseline.version}`);
    }
    summary = parts.length ? parts.join("; ") : remediation.summary || null;
  }

  return {
    has_regression: hasRegression,
    summary,
    failures,
    baseline: remediation.last_passing_baseline || null,
    regression_context: ctx
  };
}

function summarizeTopBlockers(blockers = [], limit = 3) {
  return blockers.slice(0, limit).map((b) => ({
    type: b.type,
    code: b.code || null,
    signal_id: b.signal_id || null,
    message: b.message,
    next_step: b.next_step || null
  }));
}

function mapSuggestedVerb(action) {
  if (action === "merge") return "merge";
  if (action === "escalate") return "escalate";
  return "poll";
}

function buildAgentNote(gate) {
  const action = gate.action;
  if (action === "merge") {
    return "Gate passed. Merge/deploy allowed; use check_gate in CI for branch protection exit code.";
  }
  if (action === "collecting") {
    return "Signals still arriving. Poll check_gate during the grace window; prefer release_brief when blocked after grace.";
  }
  if (action === "recover_certification") {
    return "Remediation debt active. Ship a clean CERTIFIED prod release or use incident_hotfix with corroborated incident context.";
  }
  if (action === "escalate") {
    return "Threshold failure. Review top_blockers and regression_story, attempt fixes, then escalate if still blocked.";
  }
  return "Fix blocking issues per remediation, re-post signals if needed, then check_gate or release_brief again.";
}

async function buildReleaseBrief(release, { mode, auth } = {}) {
  const gate = await buildReleaseGateResponse(release, { mode, auth, skipAudit: true });
  const regressionStory = buildRegressionStory(gate.remediation);

  return {
    brief_version: BRIEF_VERSION,
    release_id: gate.release_id,
    workspace_id: gate.workspace_id,
    version: release.version || null,
    status: gate.status,
    release_type: gate.release_type,
    commit_sha: gate.commit_sha,
    pr_number: gate.pr_number,
    mode: gate.mode,
    verdict: {
      status: gate.status,
      certified: gate.certified,
      can_merge: gate.can_merge,
      risk_level: gate.remediation?.risk_level || gate.certification?.risk_level || null,
      summary: gate.remediation?.summary || gate.certification?.summary || null,
      blocking_signals: gate.blocking_signals || [],
      missing_required_signals: gate.missing_required_signals || []
    },
    suggested_verb: mapSuggestedVerb(gate.action),
    gate_action: gate.action,
    suggested_next_tool: NEXT_TOOL_BY_ACTION[gate.action] || "check_gate",
    next_step: gate.next_step,
    top_blockers: summarizeTopBlockers(gate.blockers),
    blocker_count: (gate.blockers || []).length,
    regression_story: regressionStory,
    remediation_debt: gate.remediation_debt || { active: false },
    remediation: gate.remediation,
    certification: gate.certification,
    calibration: gate.calibration,
    hub_links: buildHubLinks({ workspaceId: gate.workspace_id }),
    agent_note: buildAgentNote(gate),
    gate: {
      allowed: gate.gate?.allowed ?? gate.can_merge,
      exit_code: gate.gate?.exit_code ?? (gate.can_merge ? 0 : 1),
      trajectory: gate.gate?.trajectory || null
    }
  };
}

async function buildReleaseBriefWithAudit(release, { mode, auth } = {}) {
  const brief = await buildReleaseBrief(release, { mode, auth });

  await writeAudit({
    workspaceId: release.workspace_id,
    releaseId: release.id,
    eventType: "RELEASE_BRIEF_READ",
    actorType: auth?.authType === "api_key" ? "AGENT" : "SYSTEM",
    actorName: auth?.authType === "api_key" ? auth.apiKeyName || "agent_runtime" : "api",
    details: {
      gate_action: brief.gate_action,
      suggested_verb: brief.suggested_verb,
      blocker_count: brief.blocker_count,
      mode: brief.mode
    }
  });

  return brief;
}

module.exports = {
  BRIEF_VERSION,
  buildHubLinks,
  buildRegressionStory,
  summarizeTopBlockers,
  mapSuggestedVerb,
  buildReleaseBrief,
  buildReleaseBriefWithAudit
};
