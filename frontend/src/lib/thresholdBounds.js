import shared from "../../../shared/config.json";

const DIRECTIONS = shared.signalThresholdDirections || {};

/**
 * @param {string} signalId
 * @returns {"min"|"max"}
 */
export function getSignalThresholdDirection(signalId) {
  const id = String(signalId || "");
  if (DIRECTIONS[id]) return DIRECTIONS[id];
  if (id.endsWith("_delta")) return "min";
  return "min";
}

/**
 * Scalar UI threshold → API { min, max } payload shape.
 * @param {string} signalId
 * @param {number} value
 */
export function valueToThresholdBounds(signalId, value) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  const dir = getSignalThresholdDirection(signalId);
  if (dir === "max") return { min: null, max: value };
  return { min: value, max: null };
}

/** Normalize stored API bounds (fixes legacy min/max inversion for max-direction signals). */
export function normalizeThresholdBounds(signalId, min, max) {
  const dir = getSignalThresholdDirection(signalId);
  if (dir === "max") {
    if (max != null) return { min: null, max };
    if (min != null) return { min: null, max: min };
    return { min: null, max: null };
  }
  if (min != null) return { min, max: null };
  if (max != null) return { min: max, max: null };
  return { min: null, max: null };
}

/** API { min, max } → scalar UI threshold value. */
export function thresholdBoundsToScalar(signalId, cfg) {
  if (!cfg || typeof cfg !== "object") return undefined;
  const normalized = normalizeThresholdBounds(signalId, cfg.min, cfg.max);
  const dir = getSignalThresholdDirection(signalId);
  const value = dir === "max" ? normalized.max : normalized.min;
  return value != null ? value : undefined;
}

/**
 * @param {Record<string, number|string>} normalized — output of normalizeThresholdsStateForSave
 */
export function thresholdNormalizedToApiPayload(normalized) {
  const thresholdPayload = {};
  Object.entries(normalized).forEach(([signalId, value]) => {
    if (typeof value !== "number") return;
    const bounds = valueToThresholdBounds(signalId, value);
    if (bounds) thresholdPayload[signalId] = bounds;
  });
  return thresholdPayload;
}
