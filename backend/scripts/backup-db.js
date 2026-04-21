"use strict";

/**
 * Dumps the PostgreSQL database using pg_dump (requires DATABASE_URL and pg_dump on PATH).
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

async function main() {
  require("../src/config");
  const url = process.env.DATABASE_URL;
  if (!url || !String(url).trim()) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }
  const outDir = process.env.BACKUP_DIR || path.join(__dirname, "..", "data", "backups");
  fs.mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(outDir, `verdikt-${ts}.sql`);
  const child = spawn("pg_dump", [String(url).trim(), "-f", dest], { stdio: "inherit" });
  await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`pg_dump exited with code ${code}`))
    );
  });
  console.log("Backup written:", dest);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
