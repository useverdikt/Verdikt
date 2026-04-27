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
  return raw.defaultThresholdSeedRows.map((row) => [...row]);
}

function getAiSignalIds() {
  return [...raw.aiSignalIds];
}

module.exports = Object.assign(
  {
    raw,
    normaliseSignalKey,
    getAllowedReleaseTypes,
    getAllowedReleaseTypesSet,
    getDefaultThresholds,
    getDefaultThresholdSeedRows,
    getAiSignalIds
  },
  raw
);
