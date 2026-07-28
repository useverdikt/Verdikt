"use strict";

/**
 * CJS mirror of severity.mjs for sync require().
 * Keep in sync with severity.mjs (asserted in p4Consistency.test.js).
 */

const SEVERITY_LEVELS = ["none", "P4", "P3", "P2", "P1", "P0"];

function severityToIndex(label) {
  const idx = SEVERITY_LEVELS.indexOf(String(label ?? "none"));
  return idx >= 0 ? idx : 0;
}

function indexToSeverity(index) {
  const idx = Math.max(0, Math.min(SEVERITY_LEVELS.length - 1, Math.round(Number(index))));
  return SEVERITY_LEVELS[idx];
}

function showstopperLabelToMaxWorstIndex(showstopperLabel) {
  const idx = severityToIndex(showstopperLabel ?? "P0");
  return idx > 0 ? idx - 1 : 4;
}

function passesShowstopperGate(worstIndex, maxWorstIndex) {
  return Number(worstIndex) <= Number(maxWorstIndex);
}

module.exports = {
  SEVERITY_LEVELS,
  severityToIndex,
  indexToSeverity,
  showstopperLabelToMaxWorstIndex,
  passesShowstopperGate
};
