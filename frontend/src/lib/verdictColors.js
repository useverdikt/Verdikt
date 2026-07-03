import { C } from "../theme/tokens.js";
import { normalizeReleaseStatus, UI_RELEASE_STATUS } from "./releaseStatus.js";

/** Dot / badge color for a release status on charts and compact indicators. */
export function verdictChartDotColor(status) {
  const rs = normalizeReleaseStatus(status);
  if (rs === UI_RELEASE_STATUS.CERTIFIED_WITH_OVERRIDE) return C.amber;
  if (rs === UI_RELEASE_STATUS.UNCERTIFIED) return C.red;
  if (rs === UI_RELEASE_STATUS.COLLECTING) return C.amber;
  return C.green;
}
