"use strict";

/**
 * Opt-in auto-apply for prod calibration suggestions (design partners only).
 * Default workspace policy is suggest_only — humans apply on /thresholds.
 */

const { getWorkspacePolicy } = require("./workspaceConfig");
const { missSuggestionsFromAlignment, mapOverBlockRawToSuggestion } = require("./calibrationSuggestions");
const { getThresholdMap } = require("./workspaceConfig");
const { safeJsonParse } = require("../lib/safeJson");
const { queryOne } = require("../database");
const { applyThresholdSuggestion } = require("./thresholdSuggestionApply");

const MIN_AUTO_APPLY_CONFIDENCE = 0.72;

function suggestionsForAlignment(workspaceId, alignmentRow, threshMap) {
  if (alignmentRow.alignment === "MISS") {
    return missSuggestionsFromAlignment(workspaceId, alignmentRow, threshMap);
  }
  if (alignmentRow.alignment === "CAUTIOUS") {
    const rawList = safeJsonParse(alignmentRow.over_block_suggestions_json, []);
    return rawList
      .map((raw) => mapOverBlockRawToSuggestion(workspaceId, alignmentRow, raw))
      .filter(Boolean);
  }
  return [];
}

/**
 * When calibration_mode is auto_apply, apply prod suggestions for this alignment event.
 * Guardrails: prod_alignment only, confidence floor, one apply per signal+direction.
 */
async function maybeAutoApplyCalibrationSuggestions(workspaceId, releaseId, alignment) {
  const mode = String(alignment || "").toUpperCase();
  if (!["MISS", "CAUTIOUS"].includes(mode)) return { applied: [], skipped: "not_actionable_alignment" };

  const policy = await getWorkspacePolicy(workspaceId);
  if (String(policy?.calibration_mode || "suggest_only") !== "auto_apply") {
    return { applied: [], skipped: "suggest_only_policy" };
  }

  const alignmentRow = await queryOne(
    `SELECT oa.*, r.version
     FROM outcome_alignments oa
     JOIN releases r ON r.id = oa.release_id
     WHERE oa.release_id = ? AND oa.workspace_id = ?`,
    [releaseId, workspaceId]
  );
  if (!alignmentRow) return { applied: [], skipped: "alignment_not_found" };

  const threshMap = await getThresholdMap(workspaceId);
  const candidates = suggestionsForAlignment(workspaceId, alignmentRow, threshMap).filter(
    (s) => s.source === "prod_alignment" && (s.confidence ?? 0) >= MIN_AUTO_APPLY_CONFIDENCE
  );

  const applied = [];
  const seen = new Set();
  for (const sug of candidates) {
    const key = `${sug.signal_id}:${sug.direction}`;
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      await applyThresholdSuggestion(workspaceId, sug, {
        actorType: "SYSTEM",
        actorName: "calibration_auto_apply",
        auto_applied: true
      });
      applied.push(sug);
    } catch (err) {
      console.error("[calibration_auto_apply] failed:", workspaceId, sug.id, err?.message);
    }
  }

  return { applied, skipped: applied.length ? null : "no_eligible_suggestions" };
}

module.exports = { maybeAutoApplyCalibrationSuggestions, MIN_AUTO_APPLY_CONFIDENCE };
