"use strict";

const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { queryOne, run } = require("../database");
const { BCRYPT_ROUNDS } = require("../config");
const { nowIso } = require("../lib/time");
const { ensureWorkspaceSeeded } = require("../services/workspaceConfig");

const IS_PROD_LIKE =
  (process.env.NODE_ENV || "development") === "production" || process.env.REQUIRE_SECURE_CONFIG === "1";

/**
 * Ensures the canonical demo account exists with password `demo123`.
 * In non-production, re-hashes the password on every startup so local DBs that
 * were registered over or restored from backups still accept the documented credentials.
 */
async function seedDemoUser() {
  const email = "demo@verdikt.local";
  const password_hash = await bcrypt.hash("demo123", BCRYPT_ROUNDS);
  const row = await queryOne("SELECT id FROM users WHERE email = ?", [email]);
  if (row) {
    if (!IS_PROD_LIKE) {
      await run("UPDATE users SET password_hash = ?, role = ? WHERE email = ?", [password_hash, "vp_engineering", email]);
    }
    return;
  }
  const id = crypto.randomUUID();
  await run(
    "INSERT INTO users (id, email, password_hash, name, workspace_id, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [id, email, password_hash, "Demo User", "ws_demo", "vp_engineering", nowIso()]
  );
}

/**
 * Second demo login (same password as demo@verdikt.local). Frontend forces the
 * screenshot gallery release list on sync so marketing / QA always see the same rows.
 */
async function seedScreenshotsGalleryUser() {
  const email = "screenshots@verdikt.local";
  const password_hash = await bcrypt.hash("demo123", BCRYPT_ROUNDS);
  const workspace_id = "ws_screenshots";
  const row = await queryOne("SELECT id FROM users WHERE email = ?", [email]);
  if (row) {
    if (!IS_PROD_LIKE) {
      await run("UPDATE users SET password_hash = ? WHERE email = ?", [password_hash, email]);
    }
    await ensureWorkspaceSeeded(workspace_id);
    return;
  }
  const id = crypto.randomUUID();
  await run(
    "INSERT INTO users (id, email, password_hash, name, workspace_id, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [id, email, password_hash, "Screenshot gallery", workspace_id, "ai_product_lead", nowIso()]
  );
  await ensureWorkspaceSeeded(workspace_id);
}

module.exports = { seedDemoUser, seedScreenshotsGalleryUser };
