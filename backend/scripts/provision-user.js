#!/usr/bin/env node
/**
 * Create a user + workspace for a design partner (when public registration is off).
 *
 *   cd backend
 *   node scripts/provision-user.js partner@company.com 'SecurePass123' 'Full Name'
 *
 * Or: PROVISION_EMAIL=... PROVISION_PASSWORD=... PROVISION_NAME='...' npm run provision:user
 */
"use strict";

const crypto = require("crypto");
const bcrypt = require("bcrypt");

require("../src/config");
const { initDatabase, queryOne, run } = require("../src/database");
const { BCRYPT_ROUNDS } = require("../src/config");
const { ensureWorkspaceSeeded } = require("../src/services/workspaceConfig");
const { nowIso } = require("../src/lib/time");

async function main() {
  await initDatabase();
  const email = (process.env.PROVISION_EMAIL || process.argv[2] || "").trim().toLowerCase();
  const password = process.env.PROVISION_PASSWORD || process.argv[3];
  const name = (process.env.PROVISION_NAME || process.argv[4] || "").trim();

  if (!email || !email.includes("@")) {
    console.error("Usage: node scripts/provision-user.js <email> <password> [full name]");
    console.error("  or: PROVISION_EMAIL=... PROVISION_PASSWORD=... PROVISION_NAME='...' npm run provision:user");
    process.exit(1);
  }
  if (typeof password !== "string" || password.length < 8) {
    console.error("Password must be at least 8 characters.");
    process.exit(1);
  }

  const existing = await queryOne("SELECT id FROM users WHERE email = ?", [email]);
  if (existing) {
    console.error("User already exists:", email);
    process.exit(1);
  }

  const id = crypto.randomUUID();
  const workspace_id = `ws_${id.replace(/-/g, "").slice(0, 16)}`;
  const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const displayName =
    name || email.split("@")[0].replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  await run(
    "INSERT INTO users (id, email, password_hash, name, workspace_id, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [id, email, password_hash, displayName, workspace_id, "ai_product_lead", nowIso()]
  );
  await ensureWorkspaceSeeded(workspace_id);

  console.log("Created user:", email);
  console.log("Workspace ID:", workspace_id);
  console.log("They can sign in at /login with the password you set.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
