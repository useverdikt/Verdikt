"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { queryOne, queryAll, run, transaction } = require("../database");
const { nowIso } = require("../lib/time");
const {
  GITHUB_APP_ID,
  GITHUB_APP_SLUG,
  GITHUB_APP_PRIVATE_KEY,
  GITHUB_APP_INSTALL_URL,
  PUBLIC_APP_URL
} = require("../config");

const INSTALL_STATE_TTL_MS = 15 * 60 * 1000;

function hasGithubAppConfig() {
  return !!(GITHUB_APP_ID && GITHUB_APP_PRIVATE_KEY && (GITHUB_APP_SLUG || GITHUB_APP_INSTALL_URL));
}

function normalizePrivateKey(key) {
  return String(key || "").replace(/\\n/g, "\n").trim();
}

function getGithubAppJwt() {
  if (!GITHUB_APP_ID || !GITHUB_APP_PRIVATE_KEY) {
    throw new Error("GitHub App credentials are not configured");
  }
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iat: now - 30,
      exp: now + 9 * 60,
      iss: String(GITHUB_APP_ID)
    },
    normalizePrivateKey(GITHUB_APP_PRIVATE_KEY),
    { algorithm: "RS256" }
  );
}

async function githubApi(path, { method = "GET", token, body, accept = "application/vnd.github+json" } = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: accept,
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = data?.message || `GitHub API ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

async function getInstallationAccessToken(installationId) {
  const appJwt = getGithubAppJwt();
  const data = await githubApi(`/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    token: appJwt
  });
  return data?.token || null;
}

async function fetchInstallationMeta(installationId) {
  const appJwt = getGithubAppJwt();
  return githubApi(`/app/installations/${installationId}`, { token: appJwt });
}

function buildInstallUrl(state) {
  if (GITHUB_APP_INSTALL_URL) {
    const u = new URL(GITHUB_APP_INSTALL_URL);
    u.searchParams.set("state", state);
    return u.toString();
  }
  return `https://github.com/apps/${encodeURIComponent(GITHUB_APP_SLUG)}/installations/new?state=${encodeURIComponent(state)}`;
}

function buildSetupRedirectUrl(query = {}) {
  const base = (PUBLIC_APP_URL || "").trim();
  if (!base) return null;
  const u = new URL("/settings", base);
  u.searchParams.set("section", "trigger");
  Object.entries(query).forEach(([k, v]) => {
    if (v == null) return;
    u.searchParams.set(k, String(v));
  });
  return u.toString();
}

async function createInstallState(workspaceId, userId = null) {
  const state = crypto.randomBytes(24).toString("hex");
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + INSTALL_STATE_TTL_MS).toISOString();
  await run(
    "INSERT INTO github_app_install_states (state, workspace_id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    [state, workspaceId, userId, expiresAt, createdAt]
  );
  return {
    state,
    install_url: buildInstallUrl(state),
    expires_at: expiresAt
  };
}

async function consumeInstallState(state) {
  const row = await queryOne("SELECT * FROM github_app_install_states WHERE state = ?", [state]);
  if (!row) return null;
  await run("DELETE FROM github_app_install_states WHERE state = ?", [state]);
  const expMs = Date.parse(row.expires_at);
  if (!Number.isFinite(expMs) || expMs < Date.now()) return null;
  return row;
}

async function setWorkspaceInstallation(workspaceId, installationId, { accountLogin, accountType, userId } = {}) {
  const ts = nowIso();
  await run(
    `INSERT INTO github_app_installations
      (workspace_id, installation_id, account_login, account_type, installed_by_user_id, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(workspace_id) DO UPDATE SET
       installation_id = excluded.installation_id,
       account_login = excluded.account_login,
       account_type = excluded.account_type,
       installed_by_user_id = excluded.installed_by_user_id,
       active = 1,
       updated_at = excluded.updated_at`,
    [workspaceId, Number(installationId), accountLogin || null, accountType || null, userId || null, ts, ts]
  );
}

async function getWorkspaceInstallation(workspaceId) {
  return queryOne("SELECT * FROM github_app_installations WHERE workspace_id = ? AND active = 1", [workspaceId]);
}

async function listWorkspaceConnectedRepos(workspaceId) {
  return queryAll(
    `SELECT repository_id, owner, repo, full_name, enabled
     FROM github_repo_connections
     WHERE workspace_id = ?
     ORDER BY LOWER(full_name) ASC`,
    [workspaceId]
  );
}

async function replaceWorkspaceConnectedRepos(workspaceId, repos = []) {
  const ts = nowIso();
  const cleaned = repos
    .map((r) => ({
      repository_id: Number(r.repository_id),
      owner: String(r.owner || "").trim(),
      repo: String(r.repo || "").trim(),
      full_name: String(r.full_name || `${String(r.owner || "").trim()}/${String(r.repo || "").trim()}`).trim()
    }))
    .filter((r) => Number.isFinite(r.repository_id) && r.owner && r.repo && r.full_name);
  await transaction(async (tx) => {
    await tx.run("DELETE FROM github_repo_connections WHERE workspace_id = ?", [workspaceId]);
    for (const r of cleaned) {
      await tx.run(
        `INSERT INTO github_repo_connections
          (workspace_id, repository_id, owner, repo, full_name, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        [workspaceId, r.repository_id, r.owner, r.repo, r.full_name, ts, ts]
      );
    }
  });
  return cleaned;
}

async function listInstallationRepos(installationId) {
  const token = await getInstallationAccessToken(installationId);
  if (!token) return [];
  const data = await githubApi("/installation/repositories?per_page=100", { token });
  return Array.isArray(data?.repositories) ? data.repositories : [];
}

async function findWorkspaceByRepo(owner, repo) {
  if (!owner || !repo) return null;
  const row = await queryOne(
    `SELECT workspace_id
     FROM github_repo_connections
     WHERE enabled = 1 AND LOWER(owner) = LOWER(?) AND LOWER(repo) = LOWER(?)
     LIMIT 1`,
    [owner, repo]
  );
  return row?.workspace_id || null;
}

module.exports = {
  hasGithubAppConfig,
  createInstallState,
  consumeInstallState,
  setWorkspaceInstallation,
  getWorkspaceInstallation,
  fetchInstallationMeta,
  buildSetupRedirectUrl,
  listWorkspaceConnectedRepos,
  replaceWorkspaceConnectedRepos,
  listInstallationRepos,
  findWorkspaceByRepo
};
