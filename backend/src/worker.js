"use strict";

/**
 * Background worker process — runs interval sweeps without the HTTP API.
 * Usage: RUN_BACKGROUND_JOBS=1 node src/worker.js
 *
 * Exposes a small health/readiness server on WORKER_PORT (default 3001) so
 * orchestrators can verify the worker is alive and has started its jobs.
 */

const http = require("http");
const { queryOne, initDatabase, closePool } = require("./database");
const { startBackgroundJobs, stopBackgroundJobs } = require("./jobs/bootstrap");
const { getOutboundEffectSweepHealth } = require("./jobs/outboundEffectSweep");

const WORKER_PORT = Math.max(0, Number(process.env.WORKER_PORT || process.env.PORT || 3001));
let jobsStarted = false;
let listeningPort = null;

function buildHealthResponse(ok, checks = {}) {
  return JSON.stringify({
    ok,
    service: "verdikt-worker",
    checks: {
      ...checks,
      outbox_shadow: getOutboundEffectSweepHealth()
    }
  });
}

function createWorkerHealthServer() {
  const server = http.createServer(async (req, res) => {
    if (req.url !== "/health" && req.url !== "/health/ready") {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }

    try {
      await queryOne("SELECT 1 AS ok");
      res.statusCode = 200;
      res.end(buildHealthResponse(true, { database: true, jobs_started: jobsStarted }));
    } catch {
      res.statusCode = 503;
      res.end(buildHealthResponse(false, { database: false, jobs_started: jobsStarted }));
    }
  });

  server.listen(WORKER_PORT, () => {
    listeningPort = server.address().port;
    console.log(`[worker] health server listening on http://localhost:${listeningPort}/health/ready`);
  });

  return server;
}

async function main() {
  await initDatabase();
  const jobs = startBackgroundJobs();
  jobsStarted = true;
  console.log(
    "[worker] background jobs started (collection, VCS monitor, escalation SLA, cert snapshot retries, shadow outbox)"
  );

  const healthServer = createWorkerHealthServer();

  const shutdown = async (signal) => {
    console.warn(`[worker] received ${signal}, stopping…`);
    jobsStarted = false;
    stopBackgroundJobs(jobs);
    healthServer.close();
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

if (require.main === module) {
  main().catch((err) => {
    console.error("[worker] failed to start:", err);
    process.exit(1);
  });
}

module.exports = {
  buildHealthResponse,
  createWorkerHealthServer,
  main
};
