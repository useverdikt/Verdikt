"use strict";

/**
 * envChain.js
 * Multi-environment certification chain.
 */

const crypto = require("crypto");
const { queryOne, queryAll, run } = require("../database");
const { nowIso } = require("../lib/time");

async function upsertEnvChain(workspaceId, { name, environments, require_all = true }) {
  if (!Array.isArray(environments) || environments.length < 2) {
    throw new Error("environments must be an array with at least 2 entries");
  }
  const envs = environments.map((e) => String(e).trim().toLowerCase()).filter(Boolean);
  if (new Set(envs).size !== envs.length) throw new Error("environments must be unique");

  const id = `chain_${workspaceId}_${crypto.createHash("md5").update(name).digest("hex").slice(0, 8)}`;
  const now = nowIso();
  await run(
    `
    INSERT INTO env_chains (id, workspace_id, name, environments, require_all, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name         = excluded.name,
      environments = excluded.environments,
      require_all  = excluded.require_all,
      updated_at   = excluded.updated_at
  `,
    [id, workspaceId, name, JSON.stringify(envs), require_all ? 1 : 0, now, now]
  );

  return getEnvChain(id);
}

async function getEnvChain(chainId) {
  const row = await queryOne("SELECT * FROM env_chains WHERE id = ?", [chainId]);
  if (!row) return null;
  return { ...row, environments: JSON.parse(row.environments || "[]") };
}

async function listEnvChains(workspaceId) {
  const rows = await queryAll("SELECT * FROM env_chains WHERE workspace_id = ? ORDER BY created_at DESC", [workspaceId]);
  return rows.map((r) => ({ ...r, environments: JSON.parse(r.environments || "[]") }));
}

async function deleteEnvChain(chainId) {
  await run("DELETE FROM env_chain_links WHERE chain_id = ?", [chainId]);
  await run("DELETE FROM env_chains WHERE id = ?", [chainId]);
}

async function registerChainLink(chainId, releaseId, environment) {
  const chain = await getEnvChain(chainId);
  if (!chain) return { ok: false, error: "chain_not_found" };

  const env = String(environment).trim().toLowerCase();
  const envIdx = chain.environments.indexOf(env);
  if (envIdx === -1) return { ok: false, error: `environment '${env}' not in chain` };

  if (chain.require_all && envIdx > 0) {
    for (let i = 0; i < envIdx; i++) {
      const prereq = chain.environments[i];
      const prereqLink = await queryOne("SELECT status FROM env_chain_links WHERE chain_id = ? AND environment = ?", [
        chainId,
        prereq
      ]);
      if (!prereqLink || prereqLink.status !== "certified") {
        return { ok: false, error: `prerequisite environment '${prereq}' is not yet certified` };
      }
    }
  }

  const now = nowIso();
  await run(
    `
    INSERT INTO env_chain_links (chain_id, release_id, environment, status, created_at)
    VALUES (?, ?, ?, 'pending', ?)
    ON CONFLICT(chain_id, environment) DO UPDATE SET
      release_id = excluded.release_id,
      status     = 'pending',
      certified_at = NULL
  `,
    [chainId, releaseId, env, now]
  );

  return { ok: true, chain_id: chainId, environment: env, status: "pending" };
}

async function updateChainLinkStatus(chainId, environment, releaseStatus) {
  const certStatuses = new Set(["CERTIFIED", "CERTIFIED_WITH_OVERRIDE"]);
  const linkStatus = certStatuses.has(releaseStatus)
    ? "certified"
    : releaseStatus === "UNCERTIFIED"
      ? "uncertified"
      : "pending";

  const certifiedAt = linkStatus === "certified" ? nowIso() : null;
  await run("UPDATE env_chain_links SET status = ?, certified_at = ? WHERE chain_id = ? AND environment = ?", [
    linkStatus,
    certifiedAt,
    chainId,
    environment
  ]);
}

async function getChainStatus(chainId) {
  const chain = await getEnvChain(chainId);
  if (!chain) return null;

  const links = await queryAll("SELECT * FROM env_chain_links WHERE chain_id = ? ORDER BY created_at ASC", [chainId]);
  const linkMap = new Map(links.map((l) => [l.environment, l]));

  const envStatuses = chain.environments.map((env, idx) => {
    const link = linkMap.get(env);
    return {
      environment: env,
      index: idx,
      status: link?.status || "not_started",
      release_id: link?.release_id || null,
      certified_at: link?.certified_at || null
    };
  });

  const allCertified = envStatuses.every((e) => e.status === "certified");
  const anyUncertified = envStatuses.some((e) => e.status === "uncertified");
  const currentEnv = envStatuses.find((e) => e.status === "pending" || e.status === "not_started");

  return {
    chain_id: chainId,
    name: chain.name,
    environments: envStatuses,
    overall: allCertified ? "complete" : anyUncertified ? "blocked" : "in_progress",
    current_environment: currentEnv?.environment || null,
    require_all: chain.require_all === 1
  };
}

async function getChainsForRelease(releaseId) {
  return queryAll(
    `
    SELECT DISTINCT cl.chain_id, cl.environment, cl.status
    FROM env_chain_links cl WHERE cl.release_id = ?
  `,
    [releaseId]
  );
}

module.exports = {
  upsertEnvChain,
  getEnvChain,
  listEnvChains,
  deleteEnvChain,
  registerChainLink,
  updateChainLinkStatus,
  getChainStatus,
  getChainsForRelease
};
