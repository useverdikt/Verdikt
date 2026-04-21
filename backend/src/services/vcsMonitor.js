"use strict";

/**
 * vcsMonitor.js
 *
 * Automatic post-deployment production health inference from VCS activity.
 * Uses the existing GitHub/GitLab integration — zero additional user configuration.
 *
 * Detection logic (in order of severity):
 *
 *   INCIDENT signals:
 *     - Any "Revert …" commit pushed after deploy         → vcs_reverts >= 1
 *     - A PR with incident/P0/emergency label opened      → vcs_incident_prs >= 1
 *     - 2+ hotfix commits in the monitoring window        → vcs_hotfixes >= 2
 *
 *   DEGRADED signals:
 *     - 1 hotfix commit (possible pre-planned patch)      → vcs_hotfixes = 1
 *     - A PR with "hotfix" label but no incident label    → vcs_incident_prs = 0, hotfix PR
 *
 *   HEALTHY:
 *     - Window closes with no findings
 *
 * All findings are written to production_observations (source = "vcs_inference")
 * and trigger the existing alignment computation automatically.
 */

const { queryOne, queryAll, run } = require("../database");
const { nowIso } = require("../lib/time");
const { getVcsIntegration } = require("./vcsWriteback");
const { ingestProductionSignals } = require("./productionFeedback");

// ─── Keyword patterns ─────────────────────────────────────────────────────────

const REVERT_RE    = /^revert\b/i;
const HOTFIX_RE    = /\b(hotfix|hot-fix|hot fix|bugfix|bug-fix|emergency fix|rollback|patch:|fix!)\b/i;
const INCIDENT_LABELS = new Set(["incident", "p0", "p1", "emergency", "hotfix", "rollback", "sev1", "sev2", "critical"]);
const HOTFIX_LABELS   = new Set(["hotfix", "hot-fix", "patch", "bug", "bugfix"]);

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

/**
 * Scan a GitHub repo for post-deploy signals.
 * Returns { revert_commits, hotfix_commits, incident_prs, raw }.
 */
async function scanGitHub(cfg, commitSha, prNumber, since, until) {
  const findings = {
    revert_commits: [],
    hotfix_commits: [],
    incident_prs: [],
    raw_commits: [],
    raw_prs: []
  };

  // 1. Get the default branch (needed to scope commit search)
  let defaultBranch = "main";
  try {
    const repo = await ghFetch(cfg, "");
    defaultBranch = repo.default_branch || "main";
  } catch (_) {}

  // 2. If we have a PR number, get the PR's head branch for a tighter commit scope
  let scanBranch = defaultBranch;
  if (prNumber) {
    try {
      const pr = await ghFetch(cfg, `/pulls/${prNumber}`);
      // Use the base branch (where the PR merged into) to find follow-up commits
      scanBranch = pr.base?.ref || defaultBranch;
    } catch (_) {}
  }

  // 3. Get commits pushed to the branch after deploy
  try {
    const sinceStr = new Date(since).toISOString();
    const untilStr = new Date(until).toISOString();
    const commits = await ghFetch(cfg, `/commits?sha=${encodeURIComponent(scanBranch)}&since=${sinceStr}&until=${untilStr}&per_page=30`);
    findings.raw_commits = Array.isArray(commits) ? commits : [];

    for (const c of findings.raw_commits) {
      const msg = (c.commit?.message || "").split("\n")[0].trim();
      // Skip the exact commit that was certified (it's the baseline)
      if (commitSha && c.sha === commitSha) continue;

      if (REVERT_RE.test(msg)) {
        findings.revert_commits.push({ sha: c.sha.slice(0, 8), message: msg });
      } else if (HOTFIX_RE.test(msg)) {
        findings.hotfix_commits.push({ sha: c.sha.slice(0, 8), message: msg });
      }
    }
  } catch (err) {
    console.warn("[vcs_monitor] commit scan error:", err.message);
  }

  // 4. Look for recently-opened PRs with incident/hotfix labels
  try {
    const prs = await ghFetch(cfg, `/pulls?state=all&sort=created&direction=desc&per_page=10`);
    const sinceMs = Date.parse(since);
    findings.raw_prs = Array.isArray(prs) ? prs : [];

    for (const pr of findings.raw_prs) {
      const createdMs = Date.parse(pr.created_at);
      if (createdMs < sinceMs) continue; // Only PRs opened after deploy
      const labels = (pr.labels || []).map((l) => l.name.toLowerCase());

      const isIncident = labels.some((l) => INCIDENT_LABELS.has(l));
      const isHotfix   = labels.some((l) => HOTFIX_LABELS.has(l));

      if (isIncident) {
        findings.incident_prs.push({ number: pr.number, title: pr.title, labels });
      } else if (isHotfix && !isIncident) {
        // Count hotfix PRs as hotfix commits
        findings.hotfix_commits.push({ sha: `PR#${pr.number}`, message: pr.title });
      }
    }
  } catch (err) {
    console.warn("[vcs_monitor] PR scan error:", err.message);
  }

  return findings;
}

// ─── GitLab scan ──────────────────────────────────────────────────────────────

async function scanGitLab(cfg, commitSha, prNumber, since, _until) {
  const findings = {
    revert_commits: [],
    hotfix_commits: [],
    incident_prs: [],
    raw_commits: [],
    raw_prs: []
  };

  // GitLab: commits since deploy on default branch
  try {
    const sinceStr = new Date(since).toISOString();
    const commits = await glFetch(cfg, `/repository/commits?since=${sinceStr}&per_page=30`);
    findings.raw_commits = Array.isArray(commits) ? commits : [];

    for (const c of findings.raw_commits) {
      const msg = (c.title || c.message || "").split("\n")[0].trim();
      if (commitSha && c.id === commitSha) continue;
      if (REVERT_RE.test(msg))      findings.revert_commits.push({ sha: (c.id || "").slice(0, 8), message: msg });
      else if (HOTFIX_RE.test(msg)) findings.hotfix_commits.push({ sha: (c.id || "").slice(0, 8), message: msg });
    }
  } catch (err) {
    console.warn("[vcs_monitor] GitLab commit scan error:", err.message);
  }

  // GitLab: merge requests with incident labels
  try {
    const sinceMs = Date.parse(since);
    const mrs = await glFetch(cfg, `/merge_requests?state=all&order_by=created_at&sort=desc&per_page=10`);
    findings.raw_prs = Array.isArray(mrs) ? mrs : [];

    for (const mr of findings.raw_prs) {
      if (Date.parse(mr.created_at) < sinceMs) continue;
      const labels = (mr.labels || []).map((l) => l.toLowerCase());
      if (labels.some((l) => INCIDENT_LABELS.has(l))) {
        findings.incident_prs.push({ number: mr.iid, title: mr.title, labels });
      } else if (labels.some((l) => HOTFIX_LABELS.has(l))) {
        findings.hotfix_commits.push({ sha: `MR!${mr.iid}`, message: mr.title });
      }
    }
  } catch (err) {
    console.warn("[vcs_monitor] GitLab MR scan error:", err.message);
  }

  return findings;
}

// ─── Signal derivation ────────────────────────────────────────────────────────

/**
 * Convert raw VCS findings into canonical production signal values.
 * These are stored in production_observations and classified by OUTCOME_CRITERIA.
 */
function findingsToSignals(findings) {
  return {
    vcs_reverts:      findings.revert_commits.length,
    vcs_hotfixes:     findings.hotfix_commits.length,
    vcs_incident_prs: findings.incident_prs.length
  };
}

// ─── Main scan function ───────────────────────────────────────────────────────

/**
 * Perform a VCS scan for a monitoring window row.
 * Writes results to production_observations and triggers alignment.
 *
 * @param {object} window  – row from vcs_monitoring_windows
 * @returns {string}       – new status: 'complete' | 'scanning' | 'error'
 */
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
    findings = cfg.provider === "github"
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
  const hasFindings = signals.vcs_reverts > 0 || signals.vcs_hotfixes > 0 || signals.vcs_incident_prs > 0;

  // Determine inferred outcome for the window record
  let inferredOutcome = "UNKNOWN";
  if (hasFindings) {
    if (signals.vcs_reverts > 0 || signals.vcs_incident_prs > 0 || signals.vcs_hotfixes >= 2) {
      inferredOutcome = "INCIDENT";
    } else {
      inferredOutcome = "DEGRADED";
    }
  } else if (windowClosed) {
    inferredOutcome = "HEALTHY";
    // Write a healthy signal so alignment system knows we checked and found nothing
    signals.vcs_healthy = 1;
  }

  // Only write signals once we have findings OR when the window closes (final healthy check)
  if (hasFindings || windowClosed) {
    // Build a human-readable summary for metadata
    const summary = buildFindingsSummary(findings, inferredOutcome);

    await ingestProductionSignals(release_id, workspace_id, signals, {
      source: "vcs_inference",
      idempotencyKey: `vcs_${release_id}_${windowClosed ? "final" : "interim"}`,
      metadata: { provider: cfg.provider, findings_summary: summary }
    });

    console.log(`[vcs_monitor] ${release_id} → ${inferredOutcome} (${JSON.stringify(signals)})`);
  }

  const newStatus = windowClosed ? "complete" : "scanning";
  await markWindow(release_id, newStatus, findings, signals, inferredOutcome);
  return newStatus;
}

function buildFindingsSummary(findings, outcome) {
  const parts = [];
  if (findings.revert_commits.length > 0)
    parts.push(`${findings.revert_commits.length} revert commit(s): ${findings.revert_commits.map(c => `"${c.message.slice(0, 50)}"`).join(", ")}`);
  if (findings.hotfix_commits.length > 0)
    parts.push(`${findings.hotfix_commits.length} hotfix commit(s): ${findings.hotfix_commits.map(c => `"${c.message.slice(0, 50)}"`).join(", ")}`);
  if (findings.incident_prs.length > 0)
    parts.push(`${findings.incident_prs.length} incident PR(s): ${findings.incident_prs.map(p => `"${p.title.slice(0, 50)}"`).join(", ")}`);
  if (parts.length === 0) parts.push("No hotfixes, reverts, or incident PRs found");
  return `${outcome}: ${parts.join("; ")}`;
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

// ─── Open a monitoring window ─────────────────────────────────────────────────

/**
 * Open a VCS monitoring window for a newly-verdicted release.
 * Safe to call multiple times — uses INSERT OR IGNORE.
 *
 * @param {object} release        – full DB row
 * @param {number} windowMinutes  – monitoring duration after verdict (default 120)
 */
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
    by_status: rows.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {}),
    by_outcome: rows.reduce((acc, r) => { if (r.inferred_outcome) acc[r.inferred_outcome] = (acc[r.inferred_outcome] || 0) + 1; return acc; }, {}),
    windows: rows.map((r) => ({
      release_id:      r.release_id,
      version:         r.version,
      status:          r.status,
      inferred_outcome: r.inferred_outcome,
      scan_count:      r.scan_count,
      monitoring_end:  r.monitoring_end,
      last_scanned_at: r.last_scanned_at,
      inferred_signals: r.inferred_signals_json ? JSON.parse(r.inferred_signals_json) : null
    }))
  };
}

module.exports = {
  openMonitoringWindow,
  scanWindow,
  getMonitoringWindow,
  getWorkspaceMonitoringSummary
};
