"use strict";

const crypto = require("crypto");
const os = require("os");
const { OUTBOX_MODE } = require("../config");
const {
  processDueOutboundEffects,
  DEFAULT_BATCH_SIZE,
  DEFAULT_LEASE_MS,
  DEFAULT_MAX_ATTEMPTS
} = require("../services/outboundEffectShadowWorker");
const { log, inc } = require("../lib/observability");

function boundedInt(raw, fallback, min, max) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

const SWEEP_MS = boundedInt(process.env.OUTBOX_SWEEP_MS, 2_000, 1_000, 60_000);
const BATCH_SIZE = boundedInt(process.env.OUTBOX_BATCH_SIZE, DEFAULT_BATCH_SIZE, 1, 100);
const LEASE_MS = boundedInt(
  process.env.OUTBOX_CLAIM_LEASE_MS,
  DEFAULT_LEASE_MS,
  1_000,
  30 * 60_000
);
const MAX_ATTEMPTS = boundedInt(
  process.env.OUTBOX_MAX_ATTEMPTS,
  DEFAULT_MAX_ATTEMPTS,
  1,
  20
);
const WORKER_ID =
  String(process.env.OUTBOX_WORKER_ID || "").trim() ||
  `${os.hostname()}:${process.pid}:${crypto.randomBytes(4).toString("hex")}`;

async function runOutboundEffectShadowSweepOnce({
  mode = OUTBOX_MODE,
  processFn = processDueOutboundEffects,
  logFn = log,
  incFn = inc
} = {}) {
  if (mode !== "shadow") {
    return { disabled: true, mode };
  }
  try {
    const result = await processFn({
      limit: BATCH_SIZE,
      workerId: WORKER_ID,
      leaseMs: LEASE_MS,
      maxAttempts: MAX_ATTEMPTS
    });
    if (result.claimed > 0) {
      logFn("info", "outbox_shadow_sweep_complete", {
        workerId: WORKER_ID,
        ...result
      });
      incFn("outbox_shadow_processed", result.claimed);
    }
    return result;
  } catch (error) {
    logFn("error", "outbox_shadow_sweep_failed", {
      workerId: WORKER_ID,
      error: String(error?.message || error).slice(0, 500)
    });
    incFn("outbox_shadow_sweep_failed");
    return null;
  }
}

function startOutboundEffectShadowSweepJob({ mode = OUTBOX_MODE } = {}) {
  if (mode !== "shadow") return null;
  const id = setInterval(() => {
    void runOutboundEffectShadowSweepOnce({ mode });
  }, SWEEP_MS);
  if (typeof id.unref === "function") id.unref();
  return id;
}

module.exports = {
  runOutboundEffectShadowSweepOnce,
  startOutboundEffectShadowSweepJob,
  SWEEP_MS,
  BATCH_SIZE,
  LEASE_MS,
  MAX_ATTEMPTS
};
