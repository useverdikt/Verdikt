"use strict";

const { runEscalationSlaSweep } = require("../services/escalations");

async function runEscalationSlaSweepJobOnce() {
  try {
    await runEscalationSlaSweep();
  } catch (err) {
    console.error("[escalation_sla_sweep]", err);
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

module.exports = { runEscalationSlaSweepJobOnce, startEscalationSlaSweepJob };
