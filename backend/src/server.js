"use strict";

const { PORT, IS_PROD_LIKE } = require("./config");
const { isPasswordResetEmailConfigured } = require("./services/email");
const { createApp } = require("./app");
const { initDatabase, closePool } = require("./database");
const { seedDemoUser, seedScreenshotsGalleryUser } = require("./bootstrap/seed");
const {
  runCollectionDeadlineSweep,
  startCollectionDeadlineSweepJob
} = require("./jobs/collectionSweep");
const { runVcsMonitorSweep, startVcsMonitorSweepJob } = require("./jobs/vcsMonitorSweep");

const SHUTDOWN_MS = Math.max(1000, Number(process.env.SHUTDOWN_GRACE_MS || 10_000));

/** Demo accounts (`demo@verdikt.local`, `screenshots@verdikt.local`) — off in production unless explicitly enabled. */
function shouldSeedDemoUsersOnStartup() {
  const raw = process.env.ENABLE_DEMO_SEED;
  if (raw === "1" || String(raw).toLowerCase() === "true") return true;
  if (raw === "0" || String(raw).toLowerCase() === "false") return false;
  return (process.env.NODE_ENV || "development") !== "production";
}

async function startServer() {
  await initDatabase();
  if (IS_PROD_LIKE && !isPasswordResetEmailConfigured()) {
    console.warn(
      "WARNING: Password reset email is not configured. Set RESEND_API_KEY and PUBLIC_APP_URL (see backend/.env.example). Forgot-password will store tokens but users will not receive a link."
    );
  }
  if (shouldSeedDemoUsersOnStartup()) {
    await seedDemoUser();
    await seedScreenshotsGalleryUser();
  } else {
    console.info(
      "INFO: Startup demo user seed is disabled in production. Set ENABLE_DEMO_SEED=1 to enable, or run `npm run seed:demos` manually."
    );
  }
  const app = createApp();
  await runCollectionDeadlineSweep();
  const sweepInterval = startCollectionDeadlineSweepJob();
  const vcsMonitorInterval = startVcsMonitorSweepJob();
  // Run an initial VCS sweep shortly after startup to pick up any windows
  // that were pending before the last restart
  setTimeout(() => void runVcsMonitorSweep().catch(() => {}), 8_000);

  const server = app.listen(PORT, () => {
    console.log(`Verdikt backend listening on http://localhost:${PORT}`);
    void runCollectionDeadlineSweep();
  });

  let shuttingDown = false;
  function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.warn(`Received ${signal}, closing HTTP server and database…`);
    if (sweepInterval) clearInterval(sweepInterval);
    if (vcsMonitorInterval) clearInterval(vcsMonitorInterval);
    server.close(async (err) => {
      // start-server-and-test (and some hosts) may close the socket before our handler runs
      if (err && err.code !== "ERR_SERVER_NOT_RUNNING") {
        console.error("HTTP server close error:", err);
      }
      try {
        await closePool();
      } catch (e) {
        console.error("Database close error:", e);
      }
      const fatal = err && err.code !== "ERR_SERVER_NOT_RUNNING";
      process.exit(fatal ? 1 : 0);
    });
    setTimeout(() => {
      console.error(`Shutdown forced after ${SHUTDOWN_MS}ms`);
      process.exit(1);
    }, SHUTDOWN_MS).unref?.();
  }

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
