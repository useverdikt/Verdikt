"use strict";

const crypto = require("crypto");
const { queryOne, queryAll, run } = require("../database");
const { nowIso, toIsoPlusMinutes } = require("../lib/time");
const { writeAudit } = require("./audit");
const { writeVcsStatus } = require("./vcsWriteback");
const { DEFAULT_COLLECTION_WINDOW_MINUTES } = require("../config");

function scheduleCollectingVcsWriteback(release) {
  if (!release || release.status !== "COLLECTING") return;
  if (!release.commit_sha && !release.pr_number) return;
  void writeVcsStatus(release, []).catch((err) =>
    console.error(`[vcs_writeback] collecting status for ${release.id}:`, err?.message || err)
  );
}

function normalizeCommitSha(sha) {
  const s = String(sha || "").trim().toLowerCase();
  if (!s) return null;
  return s;
}

function commitShaMatches(stored, candidate) {
  const a = normalizeCommitSha(stored);
  const b = normalizeCommitSha(candidate);
  if (!a || !b) return false;
  if (a === b) return true;
  const minLen = 7;
  if (a.length >= minLen && b.length >= minLen) {
    if (a.startsWith(b) || b.startsWith(a)) return true;
  }
  return false;
}

function extractCommitShaFromMetadata(meta) {
  if (!meta || typeof meta !== "object") return null;
  for (const key of ["git_sha", "commit_sha", "commit", "sha", "git_commit", "revision"]) {
    const v = meta[key];
    if (v != null && String(v).trim()) return normalizeCommitSha(String(v));
  }
  return null;
}

function metadataMatchesRelease(release, meta) {
  const candidate = extractCommitShaFromMetadata(meta);
  if (candidate && release?.commit_sha && commitShaMatches(release.commit_sha, candidate)) {
    return true;
  }
  return false;
}

function buildReleaseIdentityKey({ workspaceId, githubOwner, githubRepo, prNumber, commitSha }) {
  const ws = String(workspaceId || "").trim();
  const sha = normalizeCommitSha(commitSha);
  if (!ws || !sha) return null;
  const owner = String(githubOwner || "").trim().toLowerCase();
  const repo = String(githubRepo || "").trim().toLowerCase();
  const pr = Number.isFinite(Number(prNumber)) ? Number(prNumber) : null;
  if (owner && repo && pr != null) {
    return `release:${ws}:${owner}/${repo}:pr:${pr}:sha:${sha}`;
  }
  if (pr != null) {
    return `release:${ws}:pr:${pr}:sha:${sha}`;
  }
  return `release:${ws}:sha:${sha}`;
}

function parseGithubFromMappings(releaseRow) {
  try {
    const m = JSON.parse(releaseRow?.mappings_json || "{}");
    return {
      owner: releaseRow?.github_owner || m.owner || null,
      repo: releaseRow?.github_repo || m.repo || null,
      branch: releaseRow?.github_branch || m.branch || null,
      pr_url: m.pr_url || null
    };
  } catch {
    return {
      owner: releaseRow?.github_owner || null,
      repo: releaseRow?.github_repo || null,
      branch: releaseRow?.github_branch || null,
      pr_url: null
    };
  }
}

function buildGithubMappings({ owner, repo, branch, pr_url, extra = {} }) {
  return {
    provider: "github",
    owner: owner || null,
    repo: repo || null,
    branch: branch || null,
    pr_url: pr_url || null,
    ...extra
  };
}

/**
 * Resolve a release for signal ingest — prefer COLLECTING sessions, then latest.
 */
async function resolveReleaseForWorkspaceIngest(
  workspaceId,
  { release_id, release_ref, version, commit_sha, pr_number, github_owner, github_repo, prefer_collecting = true }
) {
  if (typeof release_id === "string" && release_id.trim()) {
    const byId = await queryOne("SELECT * FROM releases WHERE id = ? AND workspace_id = ?", [
      release_id.trim(),
      workspaceId
    ]);
    if (byId) return byId;
  }

  const sha = normalizeCommitSha(commit_sha);
  if (sha) {
    const owner = String(github_owner || "").trim().toLowerCase() || null;
    const repo = String(github_repo || "").trim().toLowerCase() || null;
    const pr = Number.isFinite(Number(pr_number)) ? Number(pr_number) : null;

    let sql = `SELECT * FROM releases WHERE workspace_id = ? AND commit_sha IS NOT NULL`;
    const params = [workspaceId];

    if (owner && repo) {
      sql += ` AND LOWER(github_owner) = ? AND LOWER(github_repo) = ?`;
      params.push(owner, repo);
    }
    if (pr != null) {
      sql += ` AND pr_number = ?`;
      params.push(pr);
    }

    sql += prefer_collecting
      ? ` ORDER BY CASE WHEN status = 'COLLECTING' THEN 0 ELSE 1 END, created_at::timestamptz DESC LIMIT 20`
      : ` ORDER BY created_at::timestamptz DESC LIMIT 20`;

    const candidates = await queryAll(sql, params);
    for (const row of candidates) {
      if (commitShaMatches(row.commit_sha, sha)) return row;
    }
  }

  const prOnly = Number.isFinite(Number(pr_number)) ? Number(pr_number) : null;
  if (prOnly != null) {
    const byPr = await queryOne(
      `SELECT * FROM releases WHERE workspace_id = ? AND pr_number = ?
       ORDER BY CASE WHEN status = 'COLLECTING' THEN 0 ELSE 1 END, created_at::timestamptz DESC LIMIT 1`,
      [workspaceId, prOnly]
    );
    if (byPr) return byPr;
  }

  const ref = typeof release_ref === "string" && release_ref.trim() ? release_ref.trim() : null;
  if (ref) {
    const byRef = await queryOne(
      "SELECT * FROM releases WHERE workspace_id = ? AND release_ref = ? ORDER BY created_at::timestamptz DESC LIMIT 1",
      [workspaceId, ref]
    );
    if (byRef) return byRef;
  }

  const ver = typeof version === "string" && version.trim() ? version.trim() : null;
  if (ver) {
    const byVersion = await queryOne(
      "SELECT * FROM releases WHERE workspace_id = ? AND version = ? ORDER BY created_at::timestamptz DESC LIMIT 1",
      [workspaceId, ver]
    );
    if (byVersion) return byVersion;
  }

  return null;
}

async function claimReleaseIdempotency(idempotencyKey, provisionalReleaseId) {
  const now = nowIso();
  const gate = await run(
    "INSERT INTO webhook_events (idempotency_key, release_id, created_at) VALUES (?, ?, ?) ON CONFLICT (idempotency_key) DO NOTHING",
    [idempotencyKey, provisionalReleaseId, now]
  );
  if (gate.changes === 0) {
    let release = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const existing = await queryOne("SELECT release_id FROM webhook_events WHERE idempotency_key = ?", [idempotencyKey]);
      if (existing?.release_id) {
        release = await queryOne("SELECT * FROM releases WHERE id = ?", [existing.release_id]);
        if (release) break;
      }
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
    return { reused: true, release };
  }
  return { reused: false, release: null };
}

/**
 * Open or reuse a certification session keyed by GitHub identity when idempotencyKey is set.
 */
async function openReleaseSession({
  workspaceId,
  version,
  releaseRef,
  releaseType,
  environment = "pre-prod",
  source,
  mappings = {},
  aiContext = {},
  collectionWindowMinutes,
  idempotencyKey = null,
  commitSha = null,
  prNumber = null,
  githubOwner = null,
  githubRepo = null,
  githubBranch = null,
  callbackUrl = null,
  auditEventType = "RELEASE_TRIGGERED",
  auditActorType = "SYSTEM",
  auditActorName = null
}) {
  const key =
    idempotencyKey ||
    buildReleaseIdentityKey({
      workspaceId,
      githubOwner: githubOwner || mappings.owner,
      githubRepo: githubRepo || mappings.repo,
      prNumber,
      commitSha
    });

  const releaseId = `rel_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
  const now = nowIso();

  if (key) {
    const claim = await claimReleaseIdempotency(key, releaseId);
    if (claim.reused && claim.release) {
      scheduleCollectingVcsWriteback(claim.release);
      return { reused: true, release: claim.release, collection_deadline: claim.release.collection_deadline };
    }
  }

  const windowMins = Number.isFinite(+collectionWindowMinutes)
    ? Math.max(5, Math.min(24 * 60, +collectionWindowMinutes))
    : DEFAULT_COLLECTION_WINDOW_MINUTES;
  const deadline = toIsoPlusMinutes(windowMins);
  const owner = githubOwner || mappings.owner || null;
  const repo = githubRepo || mappings.repo || null;
  const branch = githubBranch || mappings.branch || null;
  const sha = normalizeCommitSha(commitSha);
  const pr = Number.isFinite(Number(prNumber)) ? Number(prNumber) : null;

  await run(
    `INSERT INTO releases (
      id, workspace_id, version, release_type, environment, status, created_at, updated_at,
      release_ref, trigger_source, mappings_json, collection_deadline, verdict_issued_at,
      ai_context_json, commit_sha, pr_number, callback_url, github_owner, github_repo, github_branch
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      releaseId,
      workspaceId,
      version,
      releaseType,
      environment,
      "COLLECTING",
      now,
      now,
      releaseRef || version,
      source,
      JSON.stringify(mappings || {}),
      deadline,
      null,
      JSON.stringify(aiContext || {}),
      sha,
      pr,
      callbackUrl || null,
      owner,
      repo,
      branch
    ]
  );

  await writeAudit({
    workspaceId,
    releaseId,
    eventType: auditEventType,
    actorType: auditActorType,
    actorName: auditActorName || source,
    details: {
      release_ref: releaseRef || version,
      mappings,
      ai_context: aiContext,
      collection_window_minutes: windowMins,
      commit_sha: sha,
      pr_number: pr,
      github_owner: owner,
      github_repo: repo,
      github_branch: branch,
      identity_key: key
    }
  });

  const release = await queryOne("SELECT * FROM releases WHERE id = ?", [releaseId]);
  scheduleCollectingVcsWriteback(release);
  return { reused: false, release, collection_deadline: deadline };
}

const IDENTITY_KEY_CANDIDATES = [
  "commit_sha",
  "commit",
  "sha",
  "git_sha",
  "git_commit",
  "pr_number",
  "pr",
  "pull_request"
];

function extractIdentityFromRow(row) {
  if (!row || typeof row !== "object") {
    return { commit_sha: null, pr_number: null, version: null };
  }
  let commit_sha = null;
  let pr_number = null;
  let version = null;

  for (const pref of IDENTITY_KEY_CANDIDATES) {
    for (const k of Object.keys(row)) {
      const nk = String(k).toLowerCase().replace(/[^a-z0-9_]/g, "_");
      if (nk === pref || nk.endsWith(`_${pref}`)) {
        const raw = row[k];
        if (pref.includes("commit") || pref === "sha" || pref.includes("git")) {
          if (raw != null && String(raw).trim()) commit_sha = normalizeCommitSha(String(raw));
        } else if (pref.includes("pr")) {
          const n = Number.parseInt(String(raw), 10);
          if (Number.isFinite(n)) pr_number = n;
        }
      }
    }
  }

  for (const pref of ["version", "release_version", "release", "build", "tag"]) {
    for (const k of Object.keys(row)) {
      if (String(k).toLowerCase().replace(/[^a-z0-9_]/g, "_") === pref) {
        const v = String(row[k] ?? "").trim();
        if (v) version = v;
      }
    }
  }

  return { commit_sha, pr_number, version };
}

function computeGateAction({ status, gateAllowed, blockingSignals, missingRequiredSignals }) {
  if (gateAllowed && (status === "CERTIFIED" || status === "CERTIFIED_WITH_OVERRIDE")) {
    return "merge";
  }
  if (status === "COLLECTING" || (Array.isArray(missingRequiredSignals) && missingRequiredSignals.length > 0)) {
    return "self_heal";
  }
  if (status === "UNCERTIFIED") {
    if (Array.isArray(blockingSignals) && blockingSignals.length > 0) {
      return "escalate";
    }
    return "self_heal";
  }
  return "self_heal";
}

module.exports = {
  normalizeCommitSha,
  commitShaMatches,
  extractCommitShaFromMetadata,
  metadataMatchesRelease,
  buildReleaseIdentityKey,
  parseGithubFromMappings,
  buildGithubMappings,
  resolveReleaseForWorkspaceIngest,
  openReleaseSession,
  claimReleaseIdempotency,
  extractIdentityFromRow,
  computeGateAction
};
