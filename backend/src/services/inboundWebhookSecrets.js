"use strict";

const crypto = require("crypto");
const { queryOne, run } = require("../database");
const { nowIso } = require("../lib/time");
const { encryptToken, decryptToken, migratePlaintextFieldIfNeeded, looksEncrypted } = require("../lib/encryption");
const { WEBHOOK_SECRET, WEBHOOK_FALLBACK_SECRET } = require("../config");

/**
 * Ensures a random per-workspace signing secret exists (encrypted at rest when configured).
 */
async function ensureInboundWebhookSecret(workspaceId) {
  const row = await queryOne("SELECT secret_enc FROM workspace_inbound_webhook_secrets WHERE workspace_id = ?", [
    workspaceId
  ]);
  if (row?.secret_enc) return;

  const raw = crypto.randomBytes(32).toString("hex");
  const enc = encryptToken(raw);
  const ts = nowIso();
  await run(
    `INSERT INTO workspace_inbound_webhook_secrets (workspace_id, secret_enc, created_at, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (workspace_id) DO NOTHING`,
    [workspaceId, enc, ts, ts]
  );
}

/**
 * @param {string} workspaceId
 * @returns {Promise<string | null>} Plaintext HMAC secret or null if none
 */
async function getPlaintextInboundSecret(workspaceId) {
  const row = await queryOne("SELECT secret_enc FROM workspace_inbound_webhook_secrets WHERE workspace_id = ?", [
    workspaceId
  ]);
  if (!row?.secret_enc) return null;
  let enc = row.secret_enc;
  if (!looksEncrypted(enc)) {
    const migrated = migratePlaintextFieldIfNeeded(enc, "inbound_webhook_secret");
    if (migrated !== enc) {
      await run("UPDATE workspace_inbound_webhook_secrets SET secret_enc = ?, updated_at = ? WHERE workspace_id = ?", [
        migrated,
        nowIso(),
        workspaceId
      ]);
      enc = migrated;
    }
  }
  return decryptToken(enc);
}

function hmacHex(secret, rawBody) {
  return crypto.createHmac("sha256", secret).update(rawBody || "").digest("hex");
}

function timingEqualExpectedProvided(expectedHex, providedHex) {
  try {
    const a = Buffer.from(expectedHex, "hex");
    const b = Buffer.from(providedHex, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Validates x-verdikt-signature against per-workspace secret, then optional legacy fallbacks.
 * @param {import("express").Request} req
 * @param {string | null} [workspaceIdFromRoute] - For `/api/workspaces/:workspaceId/integrations/evals` (body may omit workspace_id)
 */
async function verifyInboundWebhookSignature(req, workspaceIdFromRoute = null) {
  const signature = req.headers["x-verdikt-signature"];
  if (typeof signature !== "string" || !signature.startsWith("sha256=")) return false;
  const rawBody = req.rawBody || "";
  if (!rawBody) return false;

  let workspaceId =
    typeof workspaceIdFromRoute === "string" && workspaceIdFromRoute.trim() ? workspaceIdFromRoute.trim() : null;
  if (!workspaceId) {
    try {
      const parsed = JSON.parse(rawBody);
      workspaceId = typeof parsed?.workspace_id === "string" ? parsed.workspace_id.trim() : null;
    } catch {
      return false;
    }
  }
  if (!workspaceId) return false;

  const provided = signature.slice("sha256=".length);

  const candidates = [];
  const wsSecret = await getPlaintextInboundSecret(workspaceId);
  if (wsSecret) candidates.push(wsSecret);
  if (WEBHOOK_FALLBACK_SECRET) candidates.push(WEBHOOK_FALLBACK_SECRET);
  if (WEBHOOK_SECRET) candidates.push(WEBHOOK_SECRET);

  const uniq = [...new Set(candidates.filter(Boolean))];
  for (const secret of uniq) {
    const expected = hmacHex(secret, rawBody);
    if (timingEqualExpectedProvided(expected, provided)) return true;
  }
  return false;
}

module.exports = {
  ensureInboundWebhookSecret,
  getPlaintextInboundSecret,
  verifyInboundWebhookSignature
};
