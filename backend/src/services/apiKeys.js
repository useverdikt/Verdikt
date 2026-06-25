"use strict";

const crypto = require("crypto");
const { queryOne, queryAll, run } = require("../database");
const { nowIso } = require("../lib/time");

const KEY_PREFIX = "vdk_live_";

function hashApiKey(rawKey) {
  return crypto.createHash("sha256").update(String(rawKey)).digest("hex");
}

function generateRawApiKey() {
  const secret = crypto.randomBytes(24).toString("base64url");
  return `${KEY_PREFIX}${secret}`;
}

function maskApiKey(rawKey) {
  const s = String(rawKey || "");
  if (s.length <= 12) return "vdk_****";
  return `${s.slice(0, 12)}…${s.slice(-4)}`;
}

async function createWorkspaceApiKey({ workspaceId, name, createdByUserId }) {
  const trimmedName = String(name || "").trim();
  if (!trimmedName) throw new Error("name is required");
  if (trimmedName.length > 80) throw new Error("name too long");

  const rawKey = generateRawApiKey();
  const keyHash = hashApiKey(rawKey);
  const id = `vak_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const ts = nowIso();
  const keyPrefix = rawKey.slice(0, 16);

  await run(
    `INSERT INTO workspace_api_keys
      (id, workspace_id, name, key_prefix, key_hash, created_by_user_id, created_at, last_used_at, revoked_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, NULL)`,
    [id, workspaceId, trimmedName, keyPrefix, keyHash, createdByUserId || null, ts]
  );

  return {
    id,
    workspace_id: workspaceId,
    name: trimmedName,
    key_prefix: keyPrefix,
    api_key: rawKey,
    created_at: ts
  };
}

async function listWorkspaceApiKeys(workspaceId) {
  const rows = await queryAll(
    `SELECT id, workspace_id, name, key_prefix, created_by_user_id, created_at, last_used_at, revoked_at
     FROM workspace_api_keys
     WHERE workspace_id = $1
     ORDER BY created_at::timestamptz DESC`,
    [workspaceId]
  );
  return rows.map((row) => ({
    id: row.id,
    workspace_id: row.workspace_id,
    name: row.name,
    key_prefix: row.key_prefix,
    masked_key: `${row.key_prefix}…`,
    created_by_user_id: row.created_by_user_id,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    revoked_at: row.revoked_at,
    active: !row.revoked_at
  }));
}

async function revokeWorkspaceApiKey(workspaceId, keyId) {
  const row = await queryOne(
    "SELECT id, revoked_at FROM workspace_api_keys WHERE id = $1 AND workspace_id = $2",
    [keyId, workspaceId]
  );
  if (!row) return null;
  if (row.revoked_at) return { id: row.id, already_revoked: true };
  const ts = nowIso();
  await run("UPDATE workspace_api_keys SET revoked_at = $1 WHERE id = $2 AND workspace_id = $3", [ts, keyId, workspaceId]);
  return { id: keyId, revoked_at: ts };
}

async function authenticateApiKey(rawKey) {
  const key = String(rawKey || "").trim();
  if (!key.startsWith(KEY_PREFIX)) return null;
  const keyHash = hashApiKey(key);
  const row = await queryOne(
    `SELECT id, workspace_id, name, key_prefix, created_by_user_id, created_at, last_used_at, revoked_at
     FROM workspace_api_keys
     WHERE key_hash = $1 AND revoked_at IS NULL`,
    [keyHash]
  );
  if (!row) return null;

  void run("UPDATE workspace_api_keys SET last_used_at = $1 WHERE id = $2", [nowIso(), row.id]).catch(() => {});

  return {
    id: row.id,
    workspace_id: row.workspace_id,
    name: row.name,
    key_prefix: row.key_prefix
  };
}

module.exports = {
  KEY_PREFIX,
  hashApiKey,
  createWorkspaceApiKey,
  listWorkspaceApiKeys,
  revokeWorkspaceApiKey,
  authenticateApiKey,
  maskApiKey
};
