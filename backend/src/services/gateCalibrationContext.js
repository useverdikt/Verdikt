"use strict";

/**
 * gateCalibrationContext.js
 *
 * Soft calibration context for check_gate — surfaces prod alignment history and
 * pending threshold suggestions without changing thresholds or gate outcomes.
 */

const { queryAll } = require("../database");
const { buildCalibrationThresholdSuggestions } = require("./calibrationSuggestions");
const { getProductionAdjustment } = require("./productionFeedback");

function slimSuggestion(s) {
  return {
    id: s.id,
    signal_id: s.signal_id,
    direction: s.direction,
    current: s.current,
    suggested: s.suggested,
    alignment: s.alignment,
    release_version: s.release_version || null,
    reason: s.reason
  };
}

function buildSummary({ pendingCount, missRecent, overBlockRecent, adjustment }) {
  const parts = [];
  if (pendingCount > 0) {
    parts.push(
      `${pendingCount} pending prod calibration suggestion${pendingCount === 1 ? "" : "s"} on Thresholds (suggest-only — not applied until a human approves).`
    );
  }
  if (missRecent) {
    parts.push(
      `Latest MISS: ${missRecent.version || missRecent.release_id?.slice(0, 8)} certified but prod was ${missRecent.actual_outcome || "degraded"}.`
    );
  }
  if (overBlockRecent) {
    parts.push(
      `Latest cautious block: ${overBlockRecent.version || overBlockRecent.release_id?.slice(0, 8)} was blocked but prod was healthy.`
    );
  }
  if (adjustment && adjustment.sample_count >= 3) {
    if (adjustment.miss_rate_pct >= 15) {
      parts.push(
        `Production track record: ${adjustment.miss_rate_pct.toFixed(0)}% miss rate across ${adjustment.sample_count} releases — apply extra caution before certifying borderline signals.`
      );
    } else if (adjustment.over_block_rate_pct >= 20) {
      parts.push(
        `Production track record: ${adjustment.over_block_rate_pct.toFixed(0)}% cautious-block rate — thresholds may be stricter than production reality.`
      );
    }
  }
  if (!parts.length) {
    return "Production alignment history is building. Thresholds are unchanged until calibration suggestions are applied on Thresholds.";
  }
  return parts.join(" ");
}

/**
 * Build soft calibration context for gate responses (does not affect can_merge).
 */
async function buildGateCalibrationContext(workspaceId) {
  const [suggestions, adjustment, recentRows] = await Promise.all([
    buildCalibrationThresholdSuggestions(workspaceId),
    getProductionAdjustment(workspaceId),
    queryAll(
      `SELECT oa.release_id, oa.alignment, oa.actual_outcome, oa.computed_at, r.version
       FROM outcome_alignments oa
       JOIN releases r ON r.id = oa.release_id
       WHERE oa.workspace_id = ? AND oa.alignment IN ('MISS', 'CAUTIOUS')
       ORDER BY oa.computed_at DESC
       LIMIT 5`,
      [workspaceId]
    )
  ]);

  const hasAdjustment = adjustment && adjustment.sample_count >= 3;
  if (!suggestions.length && !recentRows.length && !hasAdjustment) return null;

  const missRecent = recentRows.find((r) => r.alignment === "MISS") || null;
  const overBlockRecent = recentRows.find((r) => r.alignment === "CAUTIOUS") || null;

  const pending = suggestions.map(slimSuggestion);
  const summary = buildSummary({
    pendingCount: pending.length,
    missRecent,
    overBlockRecent,
    adjustment: hasAdjustment ? adjustment : null
  });

  return {
    summary,
    pending_suggestions_count: pending.length,
    pending_suggestions: pending.slice(0, 5),
    production_track_record: hasAdjustment
      ? {
          sample_count: adjustment.sample_count,
          miss_rate_pct: adjustment.miss_rate_pct,
          over_block_rate_pct: adjustment.over_block_rate_pct,
          confidence_modifier: adjustment.confidence_modifier
        }
      : null,
    recent_alignments: recentRows.map((r) => ({
      release_id: r.release_id,
      version: r.version || null,
      alignment: r.alignment,
      actual_outcome: r.actual_outcome,
      computed_at: r.computed_at
    })),
    apply_on: "/thresholds",
    mode: "suggest_only",
    note: "Calibration context is informational. Thresholds change only when suggestions are applied on Thresholds."
  };
}

module.exports = { buildGateCalibrationContext, slimSuggestion };
