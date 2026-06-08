/** Progress bar width for the full-loop funnel stage (goal = reliable_min_loops). */
export function fullLoopBarPct(count, reliableMinLoops = 10) {
  const n = Number(count) || 0;
  const min = Math.max(1, Number(reliableMinLoops) || 10);
  if (n >= min) return 100;
  if (n <= 0) return 0;
  return Math.round((n / min) * 100);
}

/** Drop-off funnel bar as a percentage of a stage denominator. */
export function pipelineFunnelBarPct(value, denominator) {
  const v = Number(value) || 0;
  const d = Number(denominator) || 0;
  if (d <= 0) return v > 0 ? 100 : 0;
  return Math.min(100, Math.round((v / d) * 100));
}
