import { C } from "../theme/tokens.js";
import { normalizeReleaseStatus, UI_RELEASE_STATUS } from "./releaseStatus.js";

/** Canonical verdict palette — single source for charts, badges, and panels. */
export const VERDICT_PALETTE = {
  [UI_RELEASE_STATUS.CERTIFIED]: {
    fg: C.green,
    dim: C.greenDim,
    label: "CERTIFIED"
  },
  [UI_RELEASE_STATUS.CERTIFIED_WITH_OVERRIDE]: {
    fg: C.amber,
    dim: C.amberDim,
    label: "WITH OVERRIDE"
  },
  [UI_RELEASE_STATUS.UNCERTIFIED]: {
    fg: C.red,
    dim: C.redDim,
    label: "UNCERTIFIED"
  },
  [UI_RELEASE_STATUS.COLLECTING]: {
    fg: C.amber,
    dim: C.amberDim,
    label: "COLLECTING"
  }
};

/** Foreground color for a release status. */
export function verdictStatusColor(status) {
  const rs = normalizeReleaseStatus(status);
  return VERDICT_PALETTE[rs]?.fg ?? C.amber;
}

/** Dot / badge color for a release status on charts and compact indicators. */
export function verdictChartDotColor(status) {
  return verdictStatusColor(status);
}

/** Compact meta for simulator / inline badges (label + fg + dot). */
export function verdictStatusMeta(status) {
  const rs = normalizeReleaseStatus(status);
  const entry = VERDICT_PALETTE[rs] ?? VERDICT_PALETTE[UI_RELEASE_STATUS.COLLECTING];
  return { label: entry.label, color: entry.fg, dot: entry.fg };
}

/** Pass/fail accent for signal rows (green vs red). */
export function verdictPassFailColor(passing) {
  return passing ? C.green : C.red;
}
