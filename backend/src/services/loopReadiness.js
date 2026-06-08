"use strict";

/** Minutes after verdict before a release counts toward loop-eligibility funnel stages. */
const LOOP_ELIGIBILITY_MINUTES = 30;

function loopEligibilityCutoffIso(nowMs = Date.now()) {
  return new Date(nowMs - LOOP_ELIGIBILITY_MINUTES * 60 * 1000).toISOString();
}

/** Fixed feedback-loop band thresholds (surfaced in API + Intelligence UI). */
const LOOP_BAND_THRESHOLDS = {
  /** 0–2 full loops */
  exploratory_max: 2,
  /** Reliable requires at least this many full loops */
  reliable_min_loops: 10,
  reliable_min_rate_pct: 60,
  stale_threshold_days: 90
};

function computeLoopBand(fullLoopCount, fullLoopRatePct) {
  const n = Number(fullLoopCount) || 0;
  const rate = Number(fullLoopRatePct) || 0;
  if (n <= LOOP_BAND_THRESHOLDS.exploratory_max) return "Exploratory";
  if (n >= LOOP_BAND_THRESHOLDS.reliable_min_loops && rate >= LOOP_BAND_THRESHOLDS.reliable_min_rate_pct) {
    return "Reliable";
  }
  return "Emerging";
}

function computeLoopNextAction({ fullLoopCount, fullLoopRatePct, verdictIssued, withObservations, isStale }) {
  const n = Number(fullLoopCount) || 0;
  const rate = Number(fullLoopRatePct) || 0;
  const emergingMin = LOOP_BAND_THRESHOLDS.exploratory_max + 1;
  const reliableMin = LOOP_BAND_THRESHOLDS.reliable_min_loops;
  const reliableRate = LOOP_BAND_THRESHOLDS.reliable_min_rate_pct;

  if (n === 0 && verdictIssued === 0) {
    return "Start by creating a release candidate and ingesting signals.";
  }
  if (n === 0 && withObservations === 0) {
    return "Connect your VCS integration to start automatic post-deploy monitoring.";
  }
  if (n === 0) {
    return "Production observations are arriving — alignment will compute automatically.";
  }
  if (n <= LOOP_BAND_THRESHOLDS.exploratory_max) {
    const need = emergingMin - n;
    return `${need} more full loop${need !== 1 ? "s" : ""} to reach Emerging.`;
  }
  if (n < reliableMin) {
    const need = reliableMin - n;
    return `${need} more full loop${need !== 1 ? "s" : ""} to reach Reliable (requires ${reliableRate}%+ rate).`;
  }
  if (rate < reliableRate) {
    return `Improve full loop rate to ${reliableRate}%+ (currently ${rate}%) to reach Reliable.`;
  }
  if (isStale) {
    return "Loop history exists but no recent loops — check your VCS monitoring windows.";
  }
  return "Feedback loop is healthy. Confidence scores are being calibrated against production reality.";
}

module.exports = {
  LOOP_ELIGIBILITY_MINUTES,
  loopEligibilityCutoffIso,
  LOOP_BAND_THRESHOLDS,
  computeLoopBand,
  computeLoopNextAction
};
