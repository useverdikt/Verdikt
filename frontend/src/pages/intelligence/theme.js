import { C as _C } from "../../theme/tokens.js";

/** App tokens with aliases used across Intelligence panels */
export const C = {
  ..._C,
  mid: _C.muted,
  accentL: _C.accent
};

export const GRADE_COLOR = {
  A: C.green,
  B: C.cyan,
  C: C.amber,
  D: "#fb923c",
  F: C.red,
  unknown: C.dim
};

export const BAND_META = {
  Exploratory: { color: "#7a788b", bg: "#7a788b18", label: "Exploratory", desc: "Early stage — fewer than 10 full loops completed." },
  Emerging: { color: "#f5a623", bg: "#f5a62318", label: "Emerging", desc: "Loop is working — building enough data to calibrate confidence." },
  Reliable: { color: "#22c87a", bg: "#22c87a18", label: "Reliable", desc: "50+ full loops at 60%+ rate. Confidence scores are grounded in production reality." }
};
