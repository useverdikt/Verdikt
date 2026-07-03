#!/usr/bin/env node
/**
 * Applies backend/migrations/postgres against the local Supabase Postgres instance.
 * Run after `supabase db reset` so app tables from migration 004+ exist before backend start.
 */
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function pick(obj, keys) {
  for (const k of keys) {
    if (obj[k] != null && String(obj[k]).length) return obj[k];
  }
  return undefined;
}

let status;
try {
  status = JSON.parse(
    execSync("npx supabase status -o json", { encoding: "utf8", cwd: root, stdio: ["ignore", "pipe", "pipe"] })
  );
} catch {
  console.error("Could not read Supabase status. Run: npx supabase start");
  process.exit(1);
}

const dbUrl = pick(status, ["DB_URL", "db_url", "DATABASE_URL"]);
if (!dbUrl) {
  console.error("Supabase status JSON has no DB_URL. Keys:", Object.keys(status));
  process.exit(1);
}

process.env.DATABASE_URL = dbUrl;
process.env.NODE_ENV = process.env.NODE_ENV || "development";

const { runMigrations } = require(join(root, "backend/src/database/runMigrations.js"));

try {
  await runMigrations();
  console.log("[backend-migrations] applied pending migrations on local Supabase Postgres");
} catch (err) {
  console.error("[backend-migrations] failed:", err.message);
  process.exit(1);
}
