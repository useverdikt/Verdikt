"use strict";

/**
 * Background worker process — runs interval sweeps without the HTTP API.
 * Usage: RUN_BACKGROUND_JOBS=1 node src/worker.js
 */

const { initDatabase, closePool } = require("./database");
const { startBackgroundJobs, stopBackgroundJobs } = require("./jobs/bootstrap");

async function main() {
  await initDatabase();
  const jobs = startBackgroundJobs();
  console.log("[worker] background jobs started (collection, VCS monitor, escalation SLA)");

  const shutdown = async (signal) => {
    console.warn(`[worker] received ${signal}, stopping…`);
    stopBackgroundJobs(jobs);
    try {
      await closePool();
    } catch (err) {
      console.error("[worker] database close error:", err?.message);
    }
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[worker] failed to start:", err);
  process.exit(1);
});
