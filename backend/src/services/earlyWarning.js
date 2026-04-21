"use strict";

/**
 * earlyWarning.js
 * Pre-release predictive warning engine.
 * During the collection window, estimates final signal risk based on
 * partial samples, producing at_risk / likely_breach / unstable_sample statuses.
 *
 * Called on every signal ingest while status = COLLECTING.
 */

const { queryOne, run } = require("../database");
const { nowIso } = require("../lib/time");

const RISK_LEVELS = Object.freeze({ stable: 0, at_risk: 1, likely_breach: 2, unstable_sample: 3 });

function computeEarlyWarnings(release, latestSignals, thresholdMap, samplePct = null) {
  const warnings = [];
  let highestRisk = "stable";

  const deadlineMs = release.collection_deadline ? Date.parse(release.collection_deadline) : null;
  const collectionStartMs = release.created_at ? Date.parse(release.created_at) : null;
  let windowElapsedPct = null;
  if (deadlineMs && collectionStartMs && Number.isFinite(deadlineMs) && Number.isFinite(collectionStartMs)) {
    const total = deadlineMs - collectionStartMs;
    const elapsed = Date.now() - collectionStartMs;
    windowElapsedPct = total > 0 ? Math.min(100, Math.max(0, (elapsed / total) * 100)) : null;
  }

  for (const [signalId, threshold] of Object.entries(thresholdMap)) {
    if (String(signalId).endsWith("_delta")) continue;
    const value = latestSignals[signalId];
    if (value == null || !Number.isFinite(value)) continue;

    const minFloor = threshold.min;
    const maxCeil = threshold.max;

    if (minFloor != null) {
      const gap = value - minFloor;
      const riskBand = minFloor * 0.05;

      if (gap < 0) {
        const w = {
          signal_id: signalId,
          risk: "likely_breach",
          value,
          threshold_min: minFloor,
          gap_to_threshold: gap,
          message: `${signalId} is at ${round2(value)} — already below floor ${minFloor}. Will fail at verdict.`
        };
        warnings.push(w);
        highestRisk = maxRisk(highestRisk, "likely_breach");
      } else if (gap < riskBand) {
        const w = {
          signal_id: signalId,
          risk: "at_risk",
          value,
          threshold_min: minFloor,
          gap_to_threshold: gap,
          message: `${signalId} is at ${round2(value)} — within ${round2(riskBand)} pts of floor ${minFloor}. At risk.`
        };
        warnings.push(w);
        highestRisk = maxRisk(highestRisk, "at_risk");
      }
    }

    if (maxCeil != null) {
      const gap = maxCeil - value;
      const riskBand = maxCeil * 0.05;
      if (gap < 0) {
        warnings.push({
          signal_id: signalId,
          risk: "likely_breach",
          value,
          threshold_max: maxCeil,
          gap_to_threshold: gap,
          message: `${signalId} is at ${round2(value)} — already above ceiling ${maxCeil}. Will fail at verdict.`
        });
        highestRisk = maxRisk(highestRisk, "likely_breach");
      } else if (gap < riskBand) {
        warnings.push({
          signal_id: signalId,
          risk: "at_risk",
          value,
          threshold_max: maxCeil,
          gap_to_threshold: gap,
          message: `${signalId} is at ${round2(value)} — within ${round2(riskBand)} pts of ceiling ${maxCeil}. At risk.`
        });
        highestRisk = maxRisk(highestRisk, "at_risk");
      }
    }
  }

  if (samplePct != null && windowElapsedPct != null && windowElapsedPct > 60 && samplePct < 40) {
    warnings.push({
      signal_id: null,
      risk: "unstable_sample",
      sample_pct: samplePct,
      window_elapsed_pct: windowElapsedPct,
      message: `Only ${round2(samplePct)}% of eval samples collected with ${round2(windowElapsedPct)}% of the window elapsed. Results may not be representative.`
    });
    highestRisk = maxRisk(highestRisk, "unstable_sample");
  }

  return {
    warnings,
    overall_risk: highestRisk,
    sample_pct: samplePct,
    window_elapsed_pct: windowElapsedPct,
    computed_at: nowIso()
  };
}

async function persistEarlyWarning(releaseId, workspaceId, earlyWarningResult) {
  const now = nowIso();
  await run(
    `
    INSERT INTO release_early_warnings
      (release_id, workspace_id, computed_at, sample_pct, warnings_json, overall_risk, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(release_id) DO UPDATE SET
      computed_at   = excluded.computed_at,
      sample_pct    = excluded.sample_pct,
      warnings_json = excluded.warnings_json,
      overall_risk  = excluded.overall_risk,
      updated_at    = excluded.updated_at
  `,
    [
      releaseId,
      workspaceId,
      earlyWarningResult.computed_at,
      earlyWarningResult.sample_pct ?? null,
      JSON.stringify(earlyWarningResult.warnings),
      earlyWarningResult.overall_risk,
      now
    ]
  );
}

async function getEarlyWarning(releaseId) {
  const row = await queryOne("SELECT * FROM release_early_warnings WHERE release_id = ?", [releaseId]);
  if (!row) return null;
  return {
    release_id: row.release_id,
    overall_risk: row.overall_risk,
    sample_pct: row.sample_pct,
    warnings: row.warnings_json ? JSON.parse(row.warnings_json) : [],
    computed_at: row.computed_at,
    updated_at: row.updated_at
  };
}

function maxRisk(a, b) {
  return RISK_LEVELS[b] > RISK_LEVELS[a] ? b : a;
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

module.exports = { computeEarlyWarnings, persistEarlyWarning, getEarlyWarning };
