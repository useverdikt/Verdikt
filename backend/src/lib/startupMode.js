"use strict";

function isProdLike() {
  return (
    (process.env.NODE_ENV || "development") === "production" ||
    process.env.REQUIRE_SECURE_CONFIG === "1"
  );
}

/**
 * In production, background jobs default to OFF on the API service so multiple
 * replicas do not duplicate sweeps. Run a dedicated `worker.js` process with
 * RUN_BACKGROUND_JOBS=1. In development/test, jobs default to ON for convenience.
 * Override with RUN_BACKGROUND_JOBS=1 or RUN_BACKGROUND_JOBS=0 in any environment.
 */
function shouldStartBackgroundJobs() {
  const raw = process.env.RUN_BACKGROUND_JOBS;
  if (raw === "1" || String(raw).toLowerCase() === "true") return true;
  if (raw === "0" || String(raw).toLowerCase() === "false") return false;
  return !isProdLike();
}

module.exports = { shouldStartBackgroundJobs };
