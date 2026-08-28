"use strict";

const { runAuditAnchorSweep } = require("../services/auditAnchor");
const { log } = require("../lib/observability");

async function runAuditAnchorJobOnce() {
  return runAuditAnchorSweep();
}

function startAuditAnchorJob() {
  if (process.env.NODE_ENV === "test" && process.env.AUDIT_ANCHOR_INTERVAL_MS == null) return null;
  const intervalMs = Number(process.env.AUDIT_ANCHOR_INTERVAL_MS ?? 15 * 60 * 1000);
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return null;
  const initialDelayMs = Math.max(5_000, Number(process.env.AUDIT_ANCHOR_INITIAL_DELAY_MS || 60_000));
  const run = () => {
    void runAuditAnchorSweep().catch((err) => {
      log("error", "audit_anchor_sweep_unhandled", { error: String(err?.message || err).slice(0, 500) });
    });
  };
  const timeout = setTimeout(run, initialDelayMs);
  const interval = setInterval(run, intervalMs);
  if (typeof timeout.unref === "function") timeout.unref();
  if (typeof interval.unref === "function") interval.unref();
  return { timeout, interval };
}

function stopAuditAnchorJob(handle) {
  if (!handle) return;
  if (handle.timeout) clearTimeout(handle.timeout);
  if (handle.interval) clearInterval(handle.interval);
}

module.exports = {
  runAuditAnchorJobOnce,
  startAuditAnchorJob,
  stopAuditAnchorJob
};
