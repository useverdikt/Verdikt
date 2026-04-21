"use strict";

/**
 * Background job: poll open VCS monitoring windows.
 */

const { queryAll } = require("../database");
const { scanWindow } = require("../services/vcsMonitor");

const SWEEP_INTERVAL_MS = 15 * 60 * 1000;
const MIN_RESCAN_MS = 5 * 60 * 1000;
const MIN_RESCAN_SEC = Math.floor(MIN_RESCAN_MS / 1000);

async function runVcsMonitorSweep() {
  const sql = `
      SELECT * FROM vcs_monitoring_windows
      WHERE status IN ('pending', 'scanning')
        AND (
          last_scanned_at IS NULL
          OR EXTRACT(EPOCH FROM (NOW() - (last_scanned_at::timestamptz))) >= ?
        )
      ORDER BY monitoring_end ASC
      LIMIT 20
    `;

  const windows = await queryAll(sql, [MIN_RESCAN_SEC]);

  if (windows.length === 0) return;

  console.log(`[vcs_monitor_sweep] scanning ${windows.length} window(s)`);

  for (const window of windows) {
    try {
      const newStatus = await scanWindow(window);
      console.log(`[vcs_monitor_sweep] ${window.release_id} → ${newStatus}`);
    } catch (err) {
      console.error(`[vcs_monitor_sweep] error for ${window.release_id}:`, err?.message);
    }
  }
}

function startVcsMonitorSweepJob() {
  const id = setInterval(() => {
    void runVcsMonitorSweep().catch((err) => console.error("[vcs_monitor_sweep] unhandled error:", err?.message));
  }, SWEEP_INTERVAL_MS);
  if (typeof id.unref === "function") id.unref();
  return id;
}

module.exports = { runVcsMonitorSweep, startVcsMonitorSweepJob };
