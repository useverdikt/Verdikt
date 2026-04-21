"use strict";

/**
 * thresholdSimulator.js
 *
 * What-if analysis: given a proposed threshold map, re-run the verdict logic
 * against historical releases to show which would flip and why.
 *
 * Reuses the exact same threshold evaluation logic as the core verdict engine —
 * no new computation; just parameterised thresholds instead of the live ones.
 */

const { queryAll } = require("../database");

/**
 * Simulate a proposed threshold map against a set of releases.
 *
 * @param {string} workspaceId
 * @param {object} proposedThresholds  – { signal_id: { min?, max? } }
 * @param {object} opts
 * @param {number} [opts.limit]        – max releases to simulate (default 50)
 * @param {string[]} [opts.releaseIds] – specific release IDs (overrides limit)
 *
 * @returns {object} simulation result
 */
async function simulateThresholds(workspaceId, proposedThresholds, opts = {}) {
  const { limit = 50, releaseIds = null } = opts;

  // Load current live thresholds for comparison + direction mapping
  const currentThresholdRows = await queryAll(
    "SELECT signal_id, min_value, max_value FROM thresholds WHERE workspace_id = ?",
    [workspaceId]
  );
  const currentThresholds = {};
  for (const r of currentThresholdRows) {
    currentThresholds[r.signal_id] = { min: r.min_value, max: r.max_value };
  }

  // Accept both:
  //  - { signal: { min, max } }
  //  - { signal: 90 }   // mapped using existing threshold direction
  const normalizedProposed = normalizeProposedThresholds(proposedThresholds, currentThresholds);

  // Load releases to simulate
  let releases;
  if (releaseIds && releaseIds.length > 0) {
    const placeholders = releaseIds.map(() => "?").join(",");
    releases = await queryAll(
      `SELECT * FROM releases WHERE workspace_id = ? AND id IN (${placeholders}) ORDER BY created_at DESC`,
      [workspaceId, ...releaseIds]
    );
  } else {
    releases = await queryAll(
      `
        SELECT * FROM releases
        WHERE workspace_id = ?
          AND status IN ('CERTIFIED', 'UNCERTIFIED', 'CERTIFIED_WITH_OVERRIDE')
        ORDER BY created_at DESC
        LIMIT ?
      `,
      [workspaceId, limit]
    );
  }

  if (releases.length === 0) {
    return { releases: [], summary: { total: 0, would_flip: 0, flip_rate_pct: 0 }, proposed_thresholds: normalizedProposed };
  }

  const results = [];
  let flipCount = 0;

  for (const release of releases) {
    // Build latest signal map for this release
    const signalRows = await queryAll("SELECT signal_id, value FROM signals WHERE release_id = ? ORDER BY id ASC", [
      release.id
    ]);
    const signalMap = {};
    for (const r of signalRows) signalMap[r.signal_id] = r.value;

    // Evaluate with current thresholds
    const currentResult = evaluateWithThresholds(release, signalMap, currentThresholds);

    // Evaluate with proposed thresholds (merge: only override specified signals)
    const mergedProposed = { ...currentThresholds };
    for (const [signalId, rule] of Object.entries(normalizedProposed)) {
      mergedProposed[signalId] = {
        min: rule.min ?? currentThresholds[signalId]?.min ?? null,
        max: rule.max ?? currentThresholds[signalId]?.max ?? null
      };
    }
    const proposedResult = evaluateWithThresholds(release, signalMap, mergedProposed);

    const wouldFlip = currentResult.verdict !== proposedResult.verdict;
    if (wouldFlip) flipCount++;

    results.push({
      release_id: release.id,
      version: release.version,
      original_verdict: currentResult.verdict,
      simulated_verdict: proposedResult.verdict,
      would_flip: wouldFlip,
      // Which signals caused the flip (delta between failure sets)
      flip_reasons: buildFlipReasons(currentResult.failed_signals, proposedResult.failed_signals, normalizedProposed),
      current_failed_signals: currentResult.failed_signals,
      simulated_failed_signals: proposedResult.failed_signals,
      signal_values: signalMap
    });
  }

  const total = results.length;
  return {
    proposed_thresholds: normalizedProposed,
    summary: {
      total,
      would_flip: flipCount,
      flip_rate_pct: total > 0 ? Math.round((flipCount / total) * 100) : 0,
      // Breakdown of flip direction
      certified_to_uncertified: results.filter((r) => r.would_flip && r.original_verdict === "CERTIFIED" && r.simulated_verdict === "UNCERTIFIED").length,
      uncertified_to_certified: results.filter((r) => r.would_flip && r.original_verdict === "UNCERTIFIED" && r.simulated_verdict === "CERTIFIED").length
    },
    releases: results
  };
}

function normalizeProposedThresholds(input, currentThresholds) {
  const out = {};
  for (const [signalId, raw] of Object.entries(input || {})) {
    // Explicit rule object
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      out[signalId] = {
        min: raw.min ?? null,
        max: raw.max ?? null
      };
      continue;
    }

    // Numeric shorthand -> map to existing direction
    if (typeof raw === "number" && Number.isFinite(raw)) {
      const cur = currentThresholds[signalId] || {};
      if (cur.min != null && cur.max == null) {
        out[signalId] = { min: raw, max: null };
      } else if (cur.max != null && cur.min == null) {
        out[signalId] = { min: null, max: raw };
      } else if (cur.min != null && cur.max != null) {
        // Rare dual-bound signal: interpret shorthand as the min boundary by default
        out[signalId] = { min: raw, max: cur.max };
      } else {
        // Unknown signal direction: fallback to min threshold semantics
        out[signalId] = { min: raw, max: null };
      }
    }
  }
  return out;
}

/**
 * Core verdict logic — mirrors domain.js computeVerdict but parameterised by
 * the provided threshold map (no DB reads inside the hot path).
 */
function evaluateWithThresholds(release, signalMap, thresholds) {
  const failedSignals = [];

  for (const [signalId, threshold] of Object.entries(thresholds)) {
    if (String(signalId).endsWith("_delta")) continue;
    const value = signalMap[signalId];
    if (value == null || !Number.isFinite(value)) continue;

    if (threshold.min != null && value < threshold.min) {
      failedSignals.push({
        signal_id: signalId,
        value,
        failure_kind: "below_min",
        threshold: threshold.min,
        rule: `>= ${threshold.min}`
      });
    }
    if (threshold.max != null && value > threshold.max) {
      failedSignals.push({
        signal_id: signalId,
        value,
        failure_kind: "above_max",
        threshold: threshold.max,
        rule: `<= ${threshold.max}`
      });
    }
  }

  // Delta-based thresholds (simple: check _delta signals if present)
  for (const [signalId, threshold] of Object.entries(thresholds)) {
    if (!String(signalId).endsWith("_delta")) continue;
    const baseSignalId = signalId.replace(/_delta$/, "");
    const value = signalMap[baseSignalId];
    if (value == null || !Number.isFinite(value)) continue;
    const delta = value; // delta signals in map are already delta values when ingest from delta system
    if (threshold.max != null && delta > threshold.max) {
      failedSignals.push({ signal_id: signalId, value: delta, failure_kind: "delta_threshold", threshold: threshold.max });
    }
  }

  return {
    verdict: failedSignals.length === 0 ? "CERTIFIED" : "UNCERTIFIED",
    failed_signals: failedSignals
  };
}

/**
 * Derive a human-readable reason for why the verdict flipped.
 * Compares old and new failure sets and attributes to proposed threshold changes.
 */
function buildFlipReasons(oldFailed, newFailed, proposedThresholds) {
  const oldIds = new Set(oldFailed.map((f) => f.signal_id));
  const newIds = new Set(newFailed.map((f) => f.signal_id));
  const reasons = [];

  // Newly failing signals (stricter threshold caused them to fail now)
  for (const f of newFailed) {
    if (!oldIds.has(f.signal_id) && proposedThresholds[f.signal_id]) {
      const proposed = proposedThresholds[f.signal_id];
      reasons.push({
        signal_id: f.signal_id,
        direction: "now_fails",
        value: f.value,
        proposed_threshold: proposed,
        message: `${f.signal_id} (${f.value}) now fails proposed threshold (${f.failure_kind === "below_min" ? `min: ${proposed.min}` : `max: ${proposed.max}`})`
      });
    }
  }

  // Signals that no longer fail (looser threshold removed a failure)
  for (const f of oldFailed) {
    if (!newIds.has(f.signal_id) && proposedThresholds[f.signal_id]) {
      const proposed = proposedThresholds[f.signal_id];
      reasons.push({
        signal_id: f.signal_id,
        direction: "now_passes",
        value: f.value,
        proposed_threshold: proposed,
        message: `${f.signal_id} (${f.value}) now passes proposed threshold (${f.failure_kind === "below_min" ? `min: ${proposed.min}` : `max: ${proposed.max}`})`
      });
    }
  }

  return reasons;
}

module.exports = { simulateThresholds };
