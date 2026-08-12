"use strict";

const crypto = require("crypto");
const os = require("os");
const { runEscalationSlaSweep } = require("../services/escalations");
const { DEFAULT_LEASE_MS } = require("../services/escalationSlaSweepClaims");

const CONFIGURED_BATCH_SIZE = Number(process.env.ESCALATION_SLA_SWEEP_BATCH_SIZE || 100);
const DEFAULT_BATCH_SIZE = Number.isFinite(CONFIGURED_BATCH_SIZE)
  ? Math.min(500, Math.max(1, Math.floor(CONFIGURED_BATCH_SIZE)))
  : 100;
const CONFIGURED_LEASE_MS = Number(
  process.env.ESCALATION_SLA_SWEEP_CLAIM_LEASE_MS || DEFAULT_LEASE_MS
);
const DEFAULT_WORKER_ID =
  String(process.env.ESCALATION_SLA_SWEEP_WORKER_ID || "").trim() ||
  `${os.hostname()}:${process.pid}:${crypto.randomBytes(4).toString("hex")}`;

async function runEscalationSlaSweepJobOnce(runSweepFn = runEscalationSlaSweep) {
  try {
    return await runSweepFn({
      limit: DEFAULT_BATCH_SIZE,
      workerId: DEFAULT_WORKER_ID,
      leaseMs: CONFIGURED_LEASE_MS
    });
  } catch (err) {
    console.error("[escalation_sla_sweep]", err);
    return null;
  }
}

function startEscalationSlaSweepJob() {
  const intervalMs = Math.max(60_000, Number(process.env.ESCALATION_SLA_SWEEP_MS || 5 * 60 * 1000));
  const id = setInterval(() => {
    void runEscalationSlaSweepJobOnce();
  }, intervalMs);
  if (typeof id.unref === "function") id.unref();
  return id;
}

module.exports = {
  runEscalationSlaSweepJobOnce,
  startEscalationSlaSweepJob,
  DEFAULT_BATCH_SIZE
};
