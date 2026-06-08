/** Severity ordering for manual QA showstopper gates (least → most severe). */
export const SEVERITY_LEVELS = ["none", "P4", "P3", "P2", "P1", "P0"];

/** @param {string} label */
export function severityToIndex(label) {
  const idx = SEVERITY_LEVELS.indexOf(String(label ?? "none"));
  return idx >= 0 ? idx : 0;
}

/** @param {number} index */
export function indexToSeverity(index) {
  const idx = Math.max(0, Math.min(SEVERITY_LEVELS.length - 1, Math.round(Number(index))));
  return SEVERITY_LEVELS[idx];
}

/**
 * Showstopper policy label → max allowed worst-severity index (lower is better).
 * P0 policy blocks P0 defects; P1 policy blocks P0 and P1, etc.
 * @param {string} showstopperLabel — configured in App → Thresholds
 */
export function showstopperLabelToMaxWorstIndex(showstopperLabel) {
  const idx = severityToIndex(showstopperLabel ?? "P0");
  return idx > 0 ? idx - 1 : 4;
}

/**
 * @param {number} worstIndex — ingested worst defect index
 * @param {number} maxWorstIndex — threshold max from policy
 */
export function passesShowstopperGate(worstIndex, maxWorstIndex) {
  return Number(worstIndex) <= Number(maxWorstIndex);
}
