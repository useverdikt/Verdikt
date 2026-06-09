/** Map backend outcome_alignments.alignment to UI alignmentVerdict slug. */
export function mapBackendAlignmentToUi(alignment) {
  if (alignment === "CORRECT") return "correct";
  if (alignment === "MISS") return "miss";
  return "uncertified";
}

/** True when production feedback loop produced a scored alignment (not pending). */
export function hasComputedAlignment(alignmentVerdict) {
  return alignmentVerdict === "correct" || alignmentVerdict === "miss";
}
