/** Map backend outcome_alignments.alignment to UI alignmentVerdict slug. */
export function mapBackendAlignmentToUi(alignment) {
  if (alignment === "CORRECT") return "correct";
  if (alignment === "MISS") return "miss";
  return "uncertified";
}

/** Badge styling for the release table Alignment column. */
export function alignBadgeMeta(alignmentVerdict) {
  if (alignmentVerdict === "correct") return { cls: "al-c", label: "CORRECT" };
  if (alignmentVerdict === "miss") return { cls: "al-m", label: "MISS" };
  return { cls: "al-u", label: "UNCERTIFIED" };
}

/** True when production feedback loop produced a scored alignment (not pending). */
export function hasComputedAlignment(alignmentVerdict) {
  return alignmentVerdict === "correct" || alignmentVerdict === "miss";
}
