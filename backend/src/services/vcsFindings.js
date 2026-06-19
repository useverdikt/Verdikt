"use strict";

/**
 * Pure VCS finding classification for post-deploy monitor (integrity-first).
 *
 * Confirmed incident signals require production impact (merge commit or revert on main).
 * Open labelled PRs are investigating only — they do not trigger MISS on their own.
 */

const REVERT_RE = /^revert\b/i;
const HOTFIX_RE = /\b(hotfix|hot-fix|hot fix|bugfix|bug-fix|emergency fix|rollback|patch:|fix!)\b/i;
const INCIDENT_LABELS = new Set(["incident", "p0", "p1", "emergency", "hotfix", "rollback", "sev1", "sev2", "critical"]);
const HOTFIX_LABELS = new Set(["hotfix", "hot-fix", "patch", "bug", "bugfix"]);

function emptyFindings() {
  return {
    revert_commits: [],
    hotfix_commits: [],
    incident_prs_merged: [],
    investigating_prs: []
  };
}

function classifyCommitMessage(msg, sha, commitSha) {
  const line = String(msg || "").split("\n")[0].trim();
  if (!line) return null;
  if (commitSha && sha === commitSha) return null;
  if (REVERT_RE.test(line)) return { kind: "revert", sha: String(sha || "").slice(0, 8), message: line };
  if (HOTFIX_RE.test(line)) return { kind: "hotfix", sha: String(sha || "").slice(0, 8), message: line };
  return null;
}

/**
 * Classify a GitHub/GitLab pull/MR for monitor window attribution.
 * @param {object} pr - { number, title, labels, state, created_at, merged_at }
 */
function classifyPullRequest(pr, { sinceMs, untilMs }) {
  const createdMs = Date.parse(pr.created_at);
  if (!Number.isFinite(createdMs) || createdMs < sinceMs) return null;

  const labels = (pr.labels || []).map((l) => String(typeof l === "string" ? l : l.name).toLowerCase());
  const isIncidentLabel = labels.some((l) => INCIDENT_LABELS.has(l));
  const isHotfixLabel = labels.some((l) => HOTFIX_LABELS.has(l)) && !isIncidentLabel;
  if (!isIncidentLabel && !isHotfixLabel) return null;

  const mergedMs = pr.merged_at ? Date.parse(pr.merged_at) : null;
  const mergedInWindow =
    mergedMs != null && Number.isFinite(mergedMs) && mergedMs >= sinceMs && mergedMs <= untilMs;
  const isOpen = String(pr.state || "").toLowerCase() === "open";

  const base = { number: pr.number, title: pr.title, labels };

  if (mergedInWindow) {
    return { bucket: isIncidentLabel ? "incident_prs_merged" : "hotfix_commits", entry: base };
  }
  if (isOpen) {
    return { bucket: "investigating_prs", entry: base };
  }
  return null;
}

function findingsToSignals(findings) {
  return {
    vcs_reverts: findings.revert_commits.length,
    vcs_hotfixes: findings.hotfix_commits.length,
    vcs_incident_prs: findings.incident_prs_merged.length,
    vcs_investigating_prs: findings.investigating_prs.length
  };
}

function hasConfirmedFindings(signals) {
  return signals.vcs_reverts > 0 || signals.vcs_hotfixes > 0 || signals.vcs_incident_prs > 0;
}

function deriveInferredOutcome(signals, windowClosed) {
  if (hasConfirmedFindings(signals)) {
    if (signals.vcs_reverts > 0 || signals.vcs_incident_prs > 0 || signals.vcs_hotfixes >= 2) {
      return "INCIDENT";
    }
    return "DEGRADED";
  }
  if (signals.vcs_investigating_prs > 0) return "INVESTIGATING";
  if (windowClosed) return "HEALTHY";
  return "UNKNOWN";
}

function buildFindingsSummary(findings, outcome) {
  const parts = [];
  if (findings.revert_commits.length > 0) {
    parts.push(
      `${findings.revert_commits.length} revert commit(s): ${findings.revert_commits.map((c) => `"${c.message.slice(0, 50)}"`).join(", ")}`
    );
  }
  if (findings.hotfix_commits.length > 0) {
    parts.push(
      `${findings.hotfix_commits.length} hotfix on main: ${findings.hotfix_commits.map((c) => `"${c.message.slice(0, 50)}"`).join(", ")}`
    );
  }
  if (findings.incident_prs_merged.length > 0) {
    parts.push(
      `${findings.incident_prs_merged.length} merged incident PR(s): ${findings.incident_prs_merged.map((p) => `"${p.title.slice(0, 50)}"`).join(", ")}`
    );
  }
  if (findings.investigating_prs.length > 0) {
    parts.push(
      `${findings.investigating_prs.length} open labelled PR(s) investigating: ${findings.investigating_prs.map((p) => `"${p.title.slice(0, 50)}"`).join(", ")}`
    );
  }
  if (parts.length === 0) parts.push("No hotfixes, reverts, or incident PRs found");
  return `${outcome}: ${parts.join("; ")}`;
}

function shouldIngestSignals(signals, windowClosed) {
  return hasConfirmedFindings(signals) || signals.vcs_investigating_prs > 0 || windowClosed;
}

module.exports = {
  REVERT_RE,
  HOTFIX_RE,
  INCIDENT_LABELS,
  HOTFIX_LABELS,
  emptyFindings,
  classifyCommitMessage,
  classifyPullRequest,
  findingsToSignals,
  hasConfirmedFindings,
  deriveInferredOutcome,
  buildFindingsSummary,
  shouldIngestSignals
};
