"use strict";

/**
 * Background job: poll open VCS monitoring windows.
 */

const crypto = require("crypto");
const os = require("os");
const { scanWindow } = require("../services/vcsMonitor");
const {
  claimDueVcsMonitoringWindows,
  completeVcsMonitorSweepClaim,
  recordVcsMonitorSweepClaimFailure,
  DEFAULT_LEASE_MS,
  DEFAULT_RESCAN_MS
} = require("../services/vcsMonitorSweepClaims");
const { log, inc } = require("../lib/observability");

const SWEEP_INTERVAL_MS = 15 * 60 * 1000;
const CONFIGURED_BATCH_SIZE = Number(process.env.VCS_MONITOR_SWEEP_BATCH_SIZE || 20);
const DEFAULT_BATCH_SIZE = Number.isFinite(CONFIGURED_BATCH_SIZE)
  ? Math.min(100, Math.max(1, Math.floor(CONFIGURED_BATCH_SIZE)))
  : 20;
const CONFIGURED_LEASE_MS = Number(process.env.VCS_MONITOR_SWEEP_CLAIM_LEASE_MS || DEFAULT_LEASE_MS);
const DEFAULT_WORKER_ID =
  String(process.env.VCS_MONITOR_SWEEP_WORKER_ID || "").trim() ||
  `${os.hostname()}:${process.pid}:${crypto.randomBytes(4).toString("hex")}`;

async function runVcsMonitorSweep({
  limit = DEFAULT_BATCH_SIZE,
  workerId = DEFAULT_WORKER_ID,
  leaseMs = CONFIGURED_LEASE_MS,
  minRescanMs = DEFAULT_RESCAN_MS,
  scanFn = scanWindow,
  claimBatchFn = claimDueVcsMonitoringWindows,
  completeClaimFn = completeVcsMonitorSweepClaim,
  failClaimFn = recordVcsMonitorSweepClaimFailure,
  logFn = log,
  incFn = inc
} = {}) {
  const batchLimit = Math.min(100, Math.max(1, Number(limit) || DEFAULT_BATCH_SIZE));
  const windows = await claimBatchFn({
    limit: batchLimit,
    workerId,
    leaseMs,
    minRescanMs
  });

  if (windows.length === 0) {
    return { worker_id: workerId, selected: 0, succeeded: 0, failed: 0 };
  }

  logFn("info", "vcs_monitor_sweep_claimed", {
    workerId,
    windowCount: windows.length,
    leaseMs: Number(leaseMs)
  });
  incFn("vcs_monitor_sweep_claimed", windows.length);

  let succeeded = 0;
  let failed = 0;
  for (const window of windows) {
    try {
      const newStatus = await scanFn(window);
      succeeded += 1;
      incFn("vcs_monitor_sweep_succeeded");
      try {
        const completion = await completeClaimFn(window.release_id, workerId);
        if (completion?.changes !== 1) {
          logFn("error", "vcs_monitor_sweep_ownership_lost", {
            releaseId: window.release_id,
            workerId
          });
          incFn("vcs_monitor_sweep_ownership_lost");
        }
      } catch (claimErr) {
        logFn("error", "vcs_monitor_sweep_claim_complete_failed", {
          releaseId: window.release_id,
          workerId,
          error: String(claimErr?.message || claimErr).slice(0, 500)
        });
        incFn("vcs_monitor_sweep_claim_complete_failed");
      }
      logFn("info", "vcs_monitor_sweep_completed", {
        releaseId: window.release_id,
        workerId,
        status: newStatus
      });
    } catch (err) {
      failed += 1;
      incFn("vcs_monitor_sweep_failed");
      try {
        await failClaimFn(window.release_id, workerId, err);
      } catch (claimErr) {
        logFn("error", "vcs_monitor_sweep_claim_failure_record_failed", {
          releaseId: window.release_id,
          workerId,
          error: String(claimErr?.message || claimErr).slice(0, 500)
        });
        incFn("vcs_monitor_sweep_claim_failure_record_failed");
      }
      logFn("error", "vcs_monitor_sweep_failed", {
        releaseId: window.release_id,
        workerId,
        error: String(err?.message || err).slice(0, 500)
      });
    }
  }

  return {
    worker_id: workerId,
    selected: windows.length,
    succeeded,
    failed
  };
}

function startVcsMonitorSweepJob() {
  const id = setInterval(() => {
    void runVcsMonitorSweep().catch((err) => console.error("[vcs_monitor_sweep] unhandled error:", err?.message));
  }, SWEEP_INTERVAL_MS);
  if (typeof id.unref === "function") id.unref();
  return id;
}

module.exports = {
  runVcsMonitorSweep,
  startVcsMonitorSweepJob,
  DEFAULT_BATCH_SIZE
};
