"use strict";

/**
 * verdictEngine.js
 *
 * Pure verdict computation: signal ingestion utilities, threshold evaluation,
 * delta analysis integration. No side effects — returns a verdict object only.
 * Extracted from domain.js to separate the decision from its consequences.
 */

const { queryOne, queryAll } = require("../database");
const sharedPkg = require("../lib/sharedPkg");
const { normaliseSignalKey } = sharedPkg;
const { analyzeReleaseDeltas } = require("./delta");
const { AI_SIGNAL_IDS, SIGNAL_ALIAS_MAP } = require("../config");
const { getThresholdMap } = require("./workspaceConfig");
const {
  isSignalRequiredForRelease
} = require("./signalScope");
const { listWorkspaceDefinitions, filterThresholdMapForAdopted } = require("./signalDefinitions");

// ─── Signal value guard ───────────────────────────────────────────────────────

function isAllowedSignalValue(signalId, value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (AI_SIGNAL_IDS.includes(signalId)) return value >= 0 && value <= 100;
  const sid = String(signalId);
  if (sid.includes("latency") || sid === "startup" || sid === "screenload") return value >= 0 && value <= 1e9;
  return Math.abs(value) <= 1e15;
}

// ─── Signal loading ───────────────────────────────────────────────────────────

async function getLatestSignalMap(releaseId) {
  const rows = await queryAll("SELECT signal_id, value FROM signals WHERE release_id = ? ORDER BY id ASC", [releaseId]);
  const latest = {};
  for (const row of rows) latest[row.signal_id] = row.value;
  return latest;
}

async function resolveReleaseRow(releaseId, releaseRow) {
  if (releaseRow && typeof releaseRow === "object") return releaseRow;
  return queryOne("SELECT * FROM releases WHERE id = ?", [releaseId]);
}

async function getMissingRequiredSignals(
  workspaceId,
  releaseId,
  preloadedLatest = null,
  releaseRow = null,
  preloadedThresholdMap = null
) {
  const [definitions, thresholdsRaw] = await Promise.all([
    listWorkspaceDefinitions(workspaceId),
    preloadedThresholdMap && typeof preloadedThresholdMap === "object"
      ? Promise.resolve(preloadedThresholdMap)
      : getThresholdMap(workspaceId)
  ]);
  const adopted = new Set(definitions.map((d) => d.signal_id));
  const thresholds = filterThresholdMapForAdopted(thresholdsRaw, adopted);
  const latest =
    preloadedLatest && typeof preloadedLatest === "object" ? preloadedLatest : await getLatestSignalMap(releaseId);
  return Object.keys(thresholds).filter((signalId) => {
    if (!isSignalRequiredForRelease(signalId, { thresholdMap: thresholds })) return false;
    return latest[signalId] == null;
  });
}

// ─── Core verdict ─────────────────────────────────────────────────────────────

/**
 * Pure verdict computation — no DB writes, no side effects.
 * Evaluates all ingested signals against thresholds; missing checks are scoped separately.
 */
async function computeVerdict(
  workspaceId,
  releaseId,
  preloadedLatest = null,
  releaseRow = null,
  preloadedThresholdMap = null
) {
  const [definitions, thresholdsRaw] = await Promise.all([
    listWorkspaceDefinitions(workspaceId),
    preloadedThresholdMap && typeof preloadedThresholdMap === "object"
      ? Promise.resolve(preloadedThresholdMap)
      : getThresholdMap(workspaceId)
  ]);
  const adopted = new Set(definitions.map((d) => d.signal_id));
  const thresholds = filterThresholdMapForAdopted(thresholdsRaw, adopted);
  const latest =
    preloadedLatest && typeof preloadedLatest === "object"
      ? preloadedLatest
      : await getLatestSignalMap(releaseId);

  const failedSignals = [];
  for (const [signalId, threshold] of Object.entries(thresholds)) {
    if (String(signalId).endsWith("_delta")) continue;
    if (!threshold.required_for_certification) continue;
    if (latest[signalId] == null) continue;
    if (threshold.min != null && latest[signalId] < threshold.min) {
      failedSignals.push({
        signal_id: signalId,
        value: latest[signalId],
        failure_kind: "absolute_threshold",
        rule: `>= ${threshold.min}`
      });
    }
    if (threshold.max != null && latest[signalId] > threshold.max) {
      failedSignals.push({
        signal_id: signalId,
        value: latest[signalId],
        failure_kind: "absolute_threshold",
        rule: `<= ${threshold.max}`
      });
    }
  }

  let deltaAnalysis = null;
  if (releaseRow) {
    deltaAnalysis = await analyzeReleaseDeltas({
      workspaceId,
      releaseId,
      releaseRow,
      latest,
      thresholdMap: thresholds
    });
    failedSignals.push(...deltaAnalysis.failures);
  }

  return {
    status: failedSignals.length === 0 ? "CERTIFIED" : "UNCERTIFIED",
    failed_signals: failedSignals,
    deltaAnalysis
  };
}

// ─── Integration helpers ──────────────────────────────────────────────────────

function mapIntegrationSignals(provider, payload) {
  const src = payload && typeof payload === "object" ? payload : {};
  const candidates = [src.signals, src.metrics, src.scores, src.results, src];
  const out = {};
  for (const obj of candidates) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) continue;
    for (const [rawKey, rawValue] of Object.entries(obj)) {
      if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) continue;
      const mapped = SIGNAL_ALIAS_MAP[normaliseSignalKey(rawKey)];
      if (mapped && isAllowedSignalValue(mapped, rawValue)) out[mapped] = rawValue;
    }
  }
  return { provider, signals: out };
}

const { resolveReleaseForWorkspaceIngest } = require("./releaseIdentity");
const { isProdEnvironment } = require("./releaseEnvironment");

function releaseVerdictLockedAgainstIngest(release) {
  if (!release) return false;
  const status = String(release.status || "").toUpperCase();
  if (
    release.verdict_issued_at &&
    (status === "CERTIFIED" || status === "CERTIFIED_WITH_OVERRIDE")
  ) {
    return true;
  }
  return status === "UNCERTIFIED" && isProdEnvironment(release.environment);
}

function releaseIngestLockError(release) {
  const status = String(release?.status || "").toUpperCase();
  if (status === "UNCERTIFIED" && isProdEnvironment(release?.environment)) {
    return "release is uncertified and live in production; gate signal ingest is closed";
  }
  return "release verdict is locked after certification; further signal ingest is not accepted";
}

/** Column names used to match a CSV row to a release (`releases.version`). */
const VERSION_KEY_CANDIDATES = ["version", "release_version", "release", "build", "tag", "ver", "v", "release_ref"];

function buildVersionColumnExclusionSet() {
  const s = new Set();
  for (const k of VERSION_KEY_CANDIDATES) s.add(normaliseSignalKey(k));
  return s;
}
const VERSION_COLUMN_EXCLUSIONS = buildVersionColumnExclusionSet();

function extractVersionFromRow(row) {
  if (!row || typeof row !== "object") return null;
  for (const pref of VERSION_KEY_CANDIDATES) {
    const np = normaliseSignalKey(pref);
    for (const k of Object.keys(row)) {
      if (normaliseSignalKey(k) === np) {
        const v = String(row[k] ?? "").trim();
        if (v) return v;
      }
    }
  }
  for (const k of Object.keys(row)) {
    if (normaliseSignalKey(k).includes("version")) {
      const v = String(row[k] ?? "").trim();
      if (v) return v;
    }
  }
  return null;
}

/**
 * Map a flat CSV / spreadsheet row to canonical signal ids (same rules as integration payloads).
 * Omits version / release identifier columns so values like "1.2.3" are not coerced to numbers.
 */
function mapFlatRowToSignals(row) {
  const out = {};
  if (!row || typeof row !== "object") return out;
  for (const [rawKey, rawValue] of Object.entries(row)) {
    const nk = normaliseSignalKey(rawKey);
    if (VERSION_COLUMN_EXCLUSIONS.has(nk)) continue;
    if (nk.includes("version")) continue;
    let num = null;
    if (typeof rawValue === "number" && Number.isFinite(rawValue)) num = rawValue;
    else if (typeof rawValue === "string") {
      const t = rawValue.trim();
      if (t === "") continue;
      const p = Number.parseFloat(t);
      if (Number.isFinite(p)) num = p;
    }
    if (num == null) continue;
    const mapped = SIGNAL_ALIAS_MAP[nk];
    if (mapped && isAllowedSignalValue(mapped, num)) out[mapped] = num;
  }
  return out;
}

module.exports = {
  isAllowedSignalValue,
  getLatestSignalMap,
  getMissingRequiredSignals,
  computeVerdict,
  mapIntegrationSignals,
  resolveReleaseForWorkspaceIngest,
  releaseVerdictLockedAgainstIngest,
  releaseIngestLockError,
  extractVersionFromRow,
  mapFlatRowToSignals
};
