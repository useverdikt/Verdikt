"use strict";

// Node / CommonJS entry: loads config.json, adds helpers. The Vite app imports config.json
// directly (same data); keep JSON as the single source of truth for serialized values.

const fs = require("fs");
const path = require("path");

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));

function normaliseSignalKey(key) {
  return String(key || "")
    .trim()
    .toLowerCase()
    .replace(/[.\s/-]+/g, "_");
}

function getAllowedReleaseTypes() {
  return [...raw.allowedReleaseTypes];
}

function getAllowedReleaseTypesSet() {
  return new Set(raw.allowedReleaseTypes);
}

function getDefaultThresholds() {
  return { ...raw.defaultThresholds };
}

function getDefaultThresholdSeedRows() {
  const thresholds = raw.defaultThresholds || {};
  return Object.entries(thresholds).map(([signalId, value]) => {
    const num = typeof value === "number" && !Number.isNaN(value) ? value : null;
    const bounds = valueToThresholdBounds(signalId, num);
    return [signalId, bounds.min, bounds.max];
  });
}

function getAiSignalIds() {
  return [...raw.aiSignalIds];
}

function getSignalThresholdDirection(signalId) {
  const id = String(signalId || "");
  if (raw.signalThresholdDirections && raw.signalThresholdDirections[id]) {
    return raw.signalThresholdDirections[id];
  }
  if (id.endsWith("_delta")) return "min";
  return "min";
}

/** UI / API scalar threshold → DB { min, max } bounds. */
function valueToThresholdBounds(signalId, value) {
  if (value == null || typeof value !== "number" || Number.isNaN(value)) {
    return { min: null, max: null };
  }
  const dir = getSignalThresholdDirection(signalId);
  if (dir === "max") return { min: null, max: value };
  return { min: value, max: null };
}

/** Normalize stored DB row (fixes legacy min/max inversion for max-direction signals). */
function normalizeThresholdBounds(signalId, min, max) {
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

function getSignalsForSource(sourceId) {
  const list = raw.signalSourceMap && raw.signalSourceMap[sourceId];
  return Array.isArray(list) ? [...list] : [];
}

function getRegressionRequiredForReleaseType(releaseTypeId) {
  const types = raw.releaseTypes || [];
  const t = types.find((r) => r.id === releaseTypeId);
  if (!t || !Object.prototype.hasOwnProperty.call(t, "regressionRequired")) return null;
  return t.regressionRequired;
}

module.exports = Object.assign(
  {
    raw,
    normaliseSignalKey,
    getAllowedReleaseTypes,
    getAllowedReleaseTypesSet,
    getDefaultThresholds,
    getDefaultThresholdSeedRows,
    getAiSignalIds,
    getSignalThresholdDirection,
    valueToThresholdBounds,
    normalizeThresholdBounds,
    getSignalsForSource,
    getRegressionRequiredForReleaseType
  },
  raw
);
