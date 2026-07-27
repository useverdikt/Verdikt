/**
 * Threshold UI persistence for offline/demo only.
 * When {@link hasBackend} is true, React state is hydrated from the API — never from these keys.
 */
import { hasBackend } from "./hasBackend.js";
import { defaultRequiredFlags } from "./thresholdBounds.js";
import { DEFAULT_THRESHOLDS } from "./workspaceDefaults.js";
import { S } from "./workspaceStorage.js";

export function readInitialThresholdUiState() {
  if (hasBackend()) {
    return {
      thresholds: { ...DEFAULT_THRESHOLDS },
      required: defaultRequiredFlags()
    };
  }
  return {
    thresholds: { ...DEFAULT_THRESHOLDS, ...S.get("thresholds", {}) },
    required: S.get("thresholdRequired", defaultRequiredFlags())
  };
}

/** Persist thresholds to localStorage only in offline/demo mode. Returns whether a write happened. */
export function persistThresholdUiState(thresholds, required) {
  if (hasBackend()) return false;
  S.set("thresholds", thresholds);
  S.set("thresholdRequired", required);
  return true;
}

export function clearThresholdLocalCache() {
  try {
    localStorage.removeItem("vdk3_thresholds");
    localStorage.removeItem("vdk3_thresholdRequired");
  } catch {
    /* ignore */
  }
}
