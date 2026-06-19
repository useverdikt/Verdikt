"use strict";

/**
 * vcsMonitor.js — post-deploy production health inference from VCS activity.
 *
 * Integrity-first rules (see vcsFindings.js):
 *   CONFIRMED (INCIDENT / DEGRADED):
 *     - Revert commit on main after deploy
 *     - Hotfix commit on main (2+ → INCIDENT, 1 → DEGRADED)
 *     - Incident-labelled PR merged within the monitor window
 *   INVESTIGATING (no MISS alone):
 *     - Open incident/hotfix-labelled PR during window — not merged
 *   IGNORED:
 *     - Closed-unmerged labelled PRs
 */

const { queryOne, queryAll, run } = require("../database");
const { nowIso } = require("../lib/time");
const { getVcsIntegration } = require("./vcsWriteback");
const { ingestProductionSignals } = require("./productionFeedback");
const {
  emptyFindings,
  classifyCommitMessage,
  classifyPullRequest,
  findingsToSignals,
  deriveInferredOutcome,
  buildFindingsSummary,
  shouldIngestSignals
} = require("./vcsFindings");

// ─── GitHub API helpers ───────────────────────────────────────────────────────

async function ghFetch(cfg, path) {
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}${path}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${cfg.access_token}`,
      "X-GitHub-Api-Version": "2022-11-28"
    },
    signal: AbortSignal.timeout(10_000)
  });
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${path}`);
  return res.json();
}

async function glFetch(cfg, path) {
  const projectPath = encodeURIComponent(`${cfg.owner}/${cfg.repo}`);
  const url = `https://gitlab.com/api/v4/projects/${projectPath}${path}`;
  const res = await fetch(url, {
    headers: { "PRIVATE-TOKEN": cfg.access_token },
    signal: AbortSignal.timeout(10_000)
  });
  if (!res.ok) throw new Error(`GitLab API ${res.status} for ${path}`);
  return res.json();
}

// ─── GitHub scan ──────────────────────────────────────────────────────────────

async function scanGitHub(cfg, commitSha, prNumber, since, until) {
  const findings = emptyFindings();
  const sinceMs = Date.parse(since);
  const untilMs = Date.parse(until);

  let defaultBranch = "main";
  try {
    const repo = await ghFetch(cfg, "");
    defaultBranch = repo.default_branch || "main";
  } catch (_) {}

  let scanBranch = defaultBranch;
  if (prNumber) {
    try {
      const pr = await ghFetch(cfg, `/pulls/${prNumber}`);
      scanBranch = pr.base?.ref || defaultBranch;
    } catch (_) {}
  }

  try {
    const sinceStr = new Date(since).toISOString();
    const untilStr = new Date(until).toISOString();
    const commits = await ghFetch(
      cfg,
      `/commits?sha=${encodeURIComponent(scanBranch)}&since=${sinceStr}&until=${untilStr}&per_page=30`
    );
    for (const c of commits || []) {
      const msg = c.commit?.message || "";
      const hit = classifyCommitMessage(msg, c.sha, commitSha);
      if (!hit) continue;
      if (hit.kind === "revert") findings.revert_commits.push(hit);
      else findings.hotfix_commits.push(hit);
    }
  } catch (err) {
    console.warn("[vcs_monitor] commit scan error:", err.message);
  }

  try {
    const prs = await ghFetch(cfg, `/pulls?state=all&sort=created&direction=desc&per_page=15`);
    for (const pr of prs || []) {
      const classified = classifyPullRequest(
        {
          number: pr.number,
          title: pr.title,
          labels: pr.labels,
          state: pr.state,
          created_at: pr.created_at,
          merged_at: pr.merged_at
        },
        { sinceMs, untilMs }
      );
      if (!classified) continue;
      if (classified.bucket === "hotfix_commits") {
        findings.hotfix_commits.push({ sha: `PR#${pr.number}`, message: pr.title });
      } else {
        findings[classified.bucket].push(classified.entry);
      }
    }
  } catch (err) {
    console.warn("[vcs_monitor] PR scan error:", err.message);
  }

  return findings;
}

// ─── GitLab scan ──────────────────────────────────────────────────────────────

async function scanGitLab(cfg, commitSha, _prNumber, since, until) {
  const findings = emptyFindings();
  const sinceMs = Date.parse(since);
  const untilMs = Date.parse(until);

  try {
    const sinceStr = new Date(since).toISOString();
    const commits = await glFetch(cfg, `/repository/commits?since=${sinceStr}&per_page=30`);
    for (const c of commits || []) {
      const msg = c.title || c.message || "";
      const hit = classifyCommitMessage(msg, c.id, commitSha);
      if (!hit) continue;
      if (hit.kind === "revert") findings.revert_commits.push(hit);
      else findings.hotfix_commits.push(hit);
    }
  } catch (err) {
    console.warn("[vcs_monitor] GitLab commit scan error:", err.message);
  }

  try {
    const mrs = await glFetch(cfg, `/merge_requests?state=all&order_by=created_at&sort=desc&per_page=15`);
    for (const mr of mrs || []) {
      const classified = classifyPullRequest(
        {
          number: mr.iid,
          title: mr.title,
          labels: mr.labels,
          state: mr.state,
          created_at: mr.created_at,
          merged_at: mr.merged_at
        },
        { sinceMs, untilMs }
      );
      if (!classified) continue;
      if (classified.bucket === "hotfix_commits") {
        findings.hotfix_commits.push({ sha: `MR!${mr.iid}`, message: mr.title });
      } else {
        findings[classified.bucket].push(classified.entry);
      }
    }
  } catch (err) {
    console.warn("[vcs_monitor] GitLab MR scan error:", err.message);
  }

  return findings;
}

// ─── Main scan function ───────────────────────────────────────────────────────

async function scanWindow(window) {
  const { release_id, workspace_id, commit_sha, pr_number, monitoring_start, monitoring_end } = window;

  const cfg = await getVcsIntegration(workspace_id);
  if (!cfg) {
    await markWindow(release_id, "no_vcs", null, null, null);
    return "no_vcs";
  }

  const now = Date.now();
  const endMs = Date.parse(monitoring_end);
  const windowClosed = now >= endMs;

  let findings;
  try {
    findings =
      cfg.provider === "github"
        ? await scanGitHub(cfg, commit_sha, pr_number, monitoring_start, monitoring_end)
        : await scanGitLab(cfg, commit_sha, pr_number, monitoring_start, monitoring_end);
  } catch (err) {
    console.error("[vcs_monitor] scan failed:", release_id, err.message);
    await run(
      "UPDATE vcs_monitoring_windows SET status = 'error', error_message = ?, last_scanned_at = ?, scan_count = scan_count + 1 WHERE release_id = ?",
      [err.message.slice(0, 200), nowIso(), release_id]
    );
    return "error";
  }

  const signals = findingsToSignals(findings);
  const inferredOutcome = deriveInferredOutcome(signals, windowClosed);

  if (windowClosed && inferredOutcome === "HEALTHY") {
    signals.vcs_healthy = 1;
  }

  if (shouldIngestSignals(signals, windowClosed)) {
    const summary = buildFindingsSummary(findings, inferredOutcome);
    await ingestProductionSignals(release_id, workspace_id, signals, {
      source: "vcs_inference",
      idempotencyKey: `vcs_${release_id}_${windowClosed ? "final" : "interim"}`,
      metadata: { provider: cfg.provider, findings_summary: summary, integrity_model: "v2" }
    });
    console.log(`[vcs_monitor] ${release_id} → ${inferredOutcome} (${JSON.stringify(signals)})`);
  }

  const newStatus = windowClosed ? "complete" : "scanning";
  await markWindow(release_id, newStatus, findings, signals, inferredOutcome);
  return newStatus;
}

async function markWindow(releaseId, status, findings, signals, outcome) {
  await run(
    `
    UPDATE vcs_monitoring_windows SET
      status                = ?,
      last_scanned_at       = ?,
      scan_count            = scan_count + 1,
      findings_json         = ?,
      inferred_signals_json = ?,
      inferred_outcome      = ?
    WHERE release_id = ?
  `,
    [
      status,
      nowIso(),
      findings ? JSON.stringify(findings) : null,
      signals ? JSON.stringify(signals) : null,
      outcome || null,
      releaseId
    ]
  );
}

// ─── Monitoring windows ─────────────────────────────────────────────────────

async function openMonitoringWindow(release, windowMinutes = 120) {
  const { id: releaseId, workspace_id, commit_sha, pr_number, verdict_issued_at } = release;

  if (!commit_sha) {
    await run(
      `
      INSERT INTO vcs_monitoring_windows
        (release_id, workspace_id, commit_sha, pr_number, monitoring_start, monitoring_end, window_minutes, status, created_at)
      VALUES (?, ?, NULL, ?, ?, ?, ?, 'no_sha', ?)
      ON CONFLICT(release_id) DO NOTHING
    `,
      [releaseId, workspace_id, pr_number || null, verdict_issued_at || nowIso(), verdict_issued_at || nowIso(), windowMinutes, nowIso()]
    );
    return;
  }

  const start = verdict_issued_at || nowIso();
  const end = new Date(Date.parse(start) + windowMinutes * 60_000).toISOString();

  await run(
    `
    INSERT INTO vcs_monitoring_windows
      (release_id, workspace_id, commit_sha, pr_number, monitoring_start, monitoring_end, window_minutes, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    ON CONFLICT(release_id) DO NOTHING
  `,
    [releaseId, workspace_id, commit_sha, pr_number || null, start, end, windowMinutes, nowIso()]
  );
}

/**
 * Reset monitor window anchored to prod merge time (integrity: window starts when code lands).
 */
async function refreshMonitoringWindowForProd(release, windowMinutes = 120) {
  const { id: releaseId, workspace_id, commit_sha, pr_number } = release;
  if (!commit_sha) {
    await openMonitoringWindow(release, windowMinutes);
    return;
  }

  const start = nowIso();
  const end = new Date(Date.parse(start) + windowMinutes * 60_000).toISOString();

  await run(
    `
    INSERT INTO vcs_monitoring_windows
      (release_id, workspace_id, commit_sha, pr_number, monitoring_start, monitoring_end, window_minutes, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    ON CONFLICT(release_id) DO UPDATE SET
      monitoring_start = excluded.monitoring_start,
      monitoring_end = excluded.monitoring_end,
      window_minutes = excluded.window_minutes,
      status = 'pending',
      inferred_outcome = NULL,
      findings_json = NULL,
      inferred_signals_json = NULL,
      last_scanned_at = NULL,
      error_message = NULL
  `,
    [releaseId, workspace_id, commit_sha, pr_number || null, start, end, windowMinutes, nowIso()]
  );
}

async function getMonitoringWindow(releaseId) {
  const row = await queryOne("SELECT * FROM vcs_monitoring_windows WHERE release_id = ?", [releaseId]);
  if (!row) return null;
  return {
    ...row,
    findings: row.findings_json ? JSON.parse(row.findings_json) : null,
    inferred_signals: row.inferred_signals_json ? JSON.parse(row.inferred_signals_json) : null
  };
}

async function getWorkspaceMonitoringSummary(workspaceId) {
  const rows = await queryAll(
    `
    SELECT vmw.*, r.version
    FROM vcs_monitoring_windows vmw
    LEFT JOIN releases r ON r.id = vmw.release_id
    WHERE vmw.workspace_id = ?
    ORDER BY vmw.created_at DESC
    LIMIT 20
  `,
    [workspaceId]
  );

  return {
    total: rows.length,
    by_status: rows.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {}),
    by_outcome: rows.reduce((acc, r) => {
      if (r.inferred_outcome) acc[r.inferred_outcome] = (acc[r.inferred_outcome] || 0) + 1;
      return acc;
    }, {}),
    windows: rows.map((r) => ({
      release_id: r.release_id,
      version: r.version,
      status: r.status,
      inferred_outcome: r.inferred_outcome,
      scan_count: r.scan_count,
      monitoring_end: r.monitoring_end,
      last_scanned_at: r.last_scanned_at,
      inferred_signals: r.inferred_signals_json ? JSON.parse(r.inferred_signals_json) : null
    }))
  };
}

module.exports = {
  openMonitoringWindow,
  refreshMonitoringWindowForProd,
  scanWindow,
  getMonitoringWindow,
  getWorkspaceMonitoringSummary
};
