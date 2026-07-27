#!/usr/bin/env node
"use strict";

/**
 * Verifies paired Supabase ↔ backend migrations share the same logical slug.
 *
 * - Supabase-only auth/RLS bootstrap files: SUPABASE_ONLY_SLUGS
 * - Backend migrations covered by the bundled initial dump or a differently
 *   named supabase-only file: BACKEND_COVERED_ELSEWHERE
 *
 * Both directions are checked so hosted-track lag cannot silently grow.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const BACKEND_DIR = path.join(ROOT, "backend", "migrations", "postgres");
const SUPABASE_DIR = path.join(ROOT, "supabase", "migrations");

/** Migrations that exist only on the Supabase track (auth bootstrap, bundled initial). */
const SUPABASE_ONLY_SLUGS = new Set([
  "verdikt_initial",
  "auth_linkage",
  "auth_user_trigger",
  "rls",
  "workspace_members_auth_backfill",
  "workspace_github_rls"
]);

/**
 * Backend migrations intentionally without a same-slug supabase counterpart.
 * - baseline: folded into verdikt_initial
 * - enable_rls_on_workspace_github_tables: covered by workspace_github_rls
 */
const BACKEND_COVERED_ELSEWHERE = new Set([
  "baseline",
  "enable_rls_on_workspace_github_tables"
]);

function logicalSlug(filename) {
  const base = filename.replace(/\.sql$/, "");
  const match = base.match(/^(?:\d+_|[0-9]{14}_)(.+)$/);
  return match ? match[1] : base;
}

function listMigrationSlugs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((file) => ({ file, slug: logicalSlug(file) }));
}

function checkMigrationParity() {
  const backend = listMigrationSlugs(BACKEND_DIR);
  const supabase = listMigrationSlugs(SUPABASE_DIR);
  const backendSlugs = new Set(backend.map((m) => m.slug));
  const supabaseSlugs = new Set(supabase.map((m) => m.slug));

  const pairedSupabase = supabase.filter((m) => !SUPABASE_ONLY_SLUGS.has(m.slug));
  const missingInBackend = pairedSupabase.filter((m) => !backendSlugs.has(m.slug));

  if (missingInBackend.length) {
    const lines = missingInBackend.map((m) => `  - ${m.file} (slug: ${m.slug})`).join("\n");
    throw new Error(
      `Supabase migrations missing backend/postgres counterparts:\n${lines}\n` +
        `Add backend/migrations/postgres/*_${missingInBackend[0].slug}.sql or update SUPABASE_ONLY_SLUGS.`
    );
  }

  const missingInSupabase = backend.filter(
    (m) => !BACKEND_COVERED_ELSEWHERE.has(m.slug) && !supabaseSlugs.has(m.slug)
  );

  if (missingInSupabase.length) {
    const lines = missingInSupabase.map((m) => `  - ${m.file} (slug: ${m.slug})`).join("\n");
    throw new Error(
      `Backend migrations missing supabase counterparts:\n${lines}\n` +
        `Add supabase/migrations/<timestamp>_${missingInSupabase[0].slug}.sql ` +
        `or update BACKEND_COVERED_ELSEWHERE if intentionally covered elsewhere.`
    );
  }

  return {
    backend_count: backend.length,
    supabase_count: supabase.length,
    paired_count: pairedSupabase.length,
    supabase_only_count: supabase.length - pairedSupabase.length,
    backend_covered_elsewhere_count: BACKEND_COVERED_ELSEWHERE.size
  };
}

if (require.main === module) {
  try {
    const summary = checkMigrationParity();
    console.log(
      `[migration-parity] OK — ${summary.paired_count} paired, ${summary.supabase_only_count} supabase-only, ` +
        `${summary.backend_covered_elsewhere_count} backend-covered-elsewhere, ${summary.backend_count} backend total`
    );
  } catch (err) {
    console.error("[migration-parity]", err.message);
    process.exit(1);
  }
}

module.exports = {
  logicalSlug,
  checkMigrationParity,
  SUPABASE_ONLY_SLUGS,
  BACKEND_COVERED_ELSEWHERE
};
