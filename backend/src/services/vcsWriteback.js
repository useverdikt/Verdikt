"use strict";

/**
 * vcsWriteback.js
 * Writes Verdikt verdict status back to GitHub/GitLab PR/commit status checks.
 */

const { queryOne, run } = require("../database");
const { nowIso } = require("../lib/time");
const { encryptToken, decryptToken, looksEncrypted, migratePlaintextFieldIfNeeded } = require("../lib/encryption");

async function getVcsIntegration(workspaceId) {
  const row = await queryOne("SELECT * FROM vcs_integrations WHERE workspace_id = ? AND enabled = 1", [workspaceId]);
  if (!row) return null;
  let tok = row.access_token;
  if (!looksEncrypted(tok)) {
    const mig = migratePlaintextFieldIfNeeded(tok, "vcs_integrations.access_token");
    if (mig !== tok) {
      await run("UPDATE vcs_integrations SET access_token = ?, updated_at = ? WHERE workspace_id = ?", [
        mig,
        nowIso(),
        workspaceId
      ]);
      tok = mig;
    }
  }
  return { ...row, access_token: decryptToken(tok) };
}

async function setVcsIntegration(workspaceId, { provider, access_token, owner, repo }) {
  const allowed = new Set(["github", "gitlab"]);
  if (!allowed.has(provider)) throw new Error("provider must be github or gitlab");
  if (!access_token || !owner || !repo) throw new Error("access_token, owner, and repo are required");
  const id = `vcs_${workspaceId}`;
  const now = nowIso();
  const tokenEnc = encryptToken(access_token);
  await run(
    `
    INSERT INTO vcs_integrations (id, workspace_id, provider, access_token, owner, repo, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET
      provider     = excluded.provider,
      access_token = excluded.access_token,
      owner        = excluded.owner,
      repo         = excluded.repo,
      enabled      = 1,
      updated_at   = excluded.updated_at
  `,
    [id, workspaceId, provider, tokenEnc, owner, repo, now, now]
  );
}

async function deleteVcsIntegration(workspaceId) {
  await run("UPDATE vcs_integrations SET enabled = 0, updated_at = ? WHERE workspace_id = ?", [nowIso(), workspaceId]);
}

function verdiktStatusToGitHub(releaseStatus) {
  const map = {
    CERTIFIED: { state: "success", description: "Release certified by Verdikt" },
    CERTIFIED_WITH_OVERRIDE: { state: "success", description: "Certified with override — review required" },
    UNCERTIFIED: { state: "failure", description: "Verdikt: release failed quality gates" },
    COLLECTING: { state: "pending", description: "Verdikt: collecting evaluation signals…" }
  };
  return map[releaseStatus] || { state: "pending", description: `Verdikt: ${releaseStatus}` };
}

function verdiktStatusToGitLab(releaseStatus) {
  const map = {
    CERTIFIED: "success",
    CERTIFIED_WITH_OVERRIDE: "success",
    UNCERTIFIED: "failed",
    COLLECTING: "running"
  };
  return map[releaseStatus] || "running";
}

async function writeGitHubStatus(cfg, commitSha, releaseStatus, targetUrl) {
  const { state, description } = verdiktStatusToGitHub(releaseStatus);
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/statuses/${commitSha}`;
  const body = JSON.stringify({
    state,
    description: description.slice(0, 140),
    context: "verdikt/certification",
    ...(targetUrl ? { target_url: targetUrl } : {})
  });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${cfg.access_token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    body
  });
  return { status: res.status, ok: res.ok };
}

async function writeGitHubPRComment(cfg, prNumber, release, failedSignals) {
  const url = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/issues/${prNumber}/comments`;
  const sigLines = (failedSignals || []).slice(0, 6).map((s) => `- **${s.signal_id}**: ${s.value ?? "missing"} — ${s.rule || "threshold"}`).join("\n");
  const statusEmoji = { CERTIFIED: "✅", CERTIFIED_WITH_OVERRIDE: "⚠️", UNCERTIFIED: "❌" }[release.status] || "⏳";
  const body =
    `## ${statusEmoji} Verdikt Certification — ${release.status}\n\n` +
    `**Version:** \`${release.version}\`  |  **Type:** ${release.release_type}  |  **Env:** ${release.environment || "—"}\n\n` +
    (failedSignals?.length > 0 ? `### Failed signals\n${sigLines}\n\n` : "All quality signals passed.\n\n") +
    `_Verdikt Release Intelligence — [view full record](https://verdikt.io)_`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${cfg.access_token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28"
    },
    body: JSON.stringify({ body })
  });
  return { status: res.status, ok: res.ok };
}

async function writeGitLabStatus(cfg, commitSha, releaseStatus, targetUrl) {
  const state = verdiktStatusToGitLab(releaseStatus);
  const projectPath = encodeURIComponent(`${cfg.owner}/${cfg.repo}`);
  const url = `https://gitlab.com/api/v4/projects/${projectPath}/statuses/${commitSha}`;
  const body = JSON.stringify({
    state,
    name: "verdikt/certification",
    description: `Verdikt: ${releaseStatus}`,
    ...(targetUrl ? { target_url: targetUrl } : {})
  });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "PRIVATE-TOKEN": cfg.access_token,
      "Content-Type": "application/json"
    },
    body
  });
  return { status: res.status, ok: res.ok };
}

async function writeVcsStatus(release, failedSignals) {
  const cfg = await getVcsIntegration(release.workspace_id);
  if (!cfg) return;

  const commitSha = release.commit_sha;
  const prNumber = release.pr_number;
  if (!commitSha && !prNumber) return;

  const targetUrl = null;

  let statusResult = null;
  let errorMessage = null;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    if (commitSha) {
      if (cfg.provider === "github") {
        statusResult = await writeGitHubStatus(cfg, commitSha, release.status, targetUrl);
      } else if (cfg.provider === "gitlab") {
        statusResult = await writeGitLabStatus(cfg, commitSha, release.status, targetUrl);
      }
    }
    if (prNumber && cfg.provider === "github" && ["CERTIFIED", "UNCERTIFIED", "CERTIFIED_WITH_OVERRIDE"].includes(release.status)) {
      await writeGitHubPRComment(cfg, prNumber, release, failedSignals);
    }
    clearTimeout(timeout);
  } catch (err) {
    errorMessage = String(err?.message || err);
    console.error(`[vcs_writeback] error for ${release.id}:`, errorMessage);
  }

  await run(
    `
    INSERT INTO vcs_status_deliveries
      (workspace_id, release_id, provider, commit_sha, pr_number, status_sent, response_code, error_message, delivered_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    [
      release.workspace_id,
      release.id,
      cfg.provider,
      commitSha || null,
      prNumber || null,
      release.status,
      statusResult?.status || null,
      errorMessage,
      nowIso()
    ]
  );
}

module.exports = { getVcsIntegration, setVcsIntegration, deleteVcsIntegration, writeVcsStatus };
