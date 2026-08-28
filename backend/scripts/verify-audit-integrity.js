"use strict";

/**
 * Read-only audit hash-chain verification for cron and post-restore drills.
 *
 *   cd backend
 *   DATABASE_URL=... node scripts/verify-audit-integrity.js
 *   DATABASE_URL=... node scripts/verify-audit-integrity.js --workspace ws_...
 *
 * Exit 0 when valid; 1 when the chain is broken/tampered or the process errors.
 * Alerts OPS_NOTIFY_EMAIL when set (and RESEND_API_KEY is configured).
 */

const { initDatabase, closePool } = require("../src/database");
const { runAuditIntegrityCheck } = require("../src/jobs/auditIntegrityCheck");

function parseWorkspaceArg(argv) {
  const idx = argv.indexOf("--workspace");
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1];
  const eq = argv.find((a) => a.startsWith("--workspace="));
  if (eq) return eq.slice("--workspace=".length);
  return null;
}

async function main() {
  require("../src/config");
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }
  const workspaceId = parseWorkspaceArg(process.argv.slice(2));
  await initDatabase();
  const result = await runAuditIntegrityCheck({ workspaceId, notify: true });
  console.log(JSON.stringify(result, null, 2));
  await closePool().catch(() => {});
  process.exit(result.valid ? 0 : 1);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
