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
const { processDueOutboundPrimaryEffects } = require("../services/outboundEffectPrimaryWorker");
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
const sweepHealth = {
  last_attempted_at: null,
  last_succeeded_at: null,
  last_failed_at: null,
  consecutive_failures: 0,
  last_summary: null
};

function timestamp(nowFn) {
  const value = nowFn();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function getOutboundEffectSweepHealth() {
  return {
    mode: OUTBOX_MODE,
    enabled: OUTBOX_MODE === "shadow" || OUTBOX_MODE === "primary",
    ...sweepHealth,
    last_summary: sweepHealth.last_summary ? { ...sweepHealth.last_summary } : null
  };
}

async function runOutboundEffectShadowSweepOnce({
  mode = OUTBOX_MODE,
  processFn = null,
  logFn = log,
  incFn = inc,
  nowFn = () => new Date()
} = {}) {
  if (mode !== "shadow" && mode !== "primary") {
    return { disabled: true, mode };
  }
  const resolvedProcess =
    processFn || (mode === "primary" ? processDueOutboundPrimaryEffects : processDueOutboundEffects);
  const eventComplete = mode === "primary" ? "outbox_primary_sweep_complete" : "outbox_shadow_sweep_complete";
  const eventFailed = mode === "primary" ? "outbox_primary_sweep_failed" : "outbox_shadow_sweep_failed";
  const counterProcessed = mode === "primary" ? "outbox_primary_processed" : "outbox_shadow_processed";
  const counterFailed = mode === "primary" ? "outbox_primary_sweep_failed" : "outbox_shadow_sweep_failed";
  sweepHealth.last_attempted_at = timestamp(nowFn);
  try {
    const result = await resolvedProcess({
      limit: BATCH_SIZE,
      workerId: WORKER_ID,
      leaseMs: LEASE_MS,
      maxAttempts: MAX_ATTEMPTS
    });
    if (result.claimed > 0) {
      logFn("info", eventComplete, {
        workerId: WORKER_ID,
        ...result
      });
      incFn(counterProcessed, result.claimed);
    }
    sweepHealth.last_succeeded_at = timestamp(nowFn);
    sweepHealth.consecutive_failures = 0;
    sweepHealth.last_summary = {
      claimed: Number(result.claimed || 0),
      mismatched: Number(result.mismatched || 0),
      retried: Number(result.retried || 0),
      dead_lettered: Number(result.dead_lettered || 0),
      delivered: Number(result.delivered || 0)
    };
    return result;
  } catch (error) {
    sweepHealth.last_failed_at = timestamp(nowFn);
    sweepHealth.consecutive_failures += 1;
    logFn("error", eventFailed, {
      workerId: WORKER_ID,
      error: String(error?.message || error).slice(0, 500)
    });
    incFn(counterFailed);
    return null;
  }
}

function startOutboundEffectShadowSweepJob({ mode = OUTBOX_MODE } = {}) {
  if (mode !== "shadow" && mode !== "primary") return null;
  const id = setInterval(() => {
    void runOutboundEffectShadowSweepOnce({ mode });
  }, SWEEP_MS);
  if (typeof id.unref === "function") id.unref();
  return id;
}

module.exports = {
  runOutboundEffectShadowSweepOnce,
  startOutboundEffectShadowSweepJob,
  getOutboundEffectSweepHealth,
  SWEEP_MS,
  BATCH_SIZE,
  LEASE_MS,
  MAX_ATTEMPTS
};
