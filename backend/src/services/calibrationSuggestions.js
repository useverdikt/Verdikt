"use strict";

/**
 * calibrationSuggestions.js
 *
 * Turns production alignment rows (MISS / CAUTIOUS) into threshold suggestions
 * compatible with the existing threshold-suggestions apply/dismiss API.
 *
 * Suggest-only: humans apply on /thresholds; next check_gate reads updated thresholds.
 */

const { queryAll } = require("../database");
const { safeJsonParse } = require("../lib/safeJson");
const { getThresholdMap } = require("./workspaceConfig");
const {
  loadDismissedSuggestionKeys,
  isSuggestionDismissed
} = require("./thresholdSuggestionDismissals");

function calibrationSuggestionId(workspaceId, releaseId, signalId, direction) {
  return `cal:${workspaceId}:${releaseId}:${signalId}:${direction}`;
}

function mapOverBlockRawToSuggestion(workspaceId, alignment, raw) {
  const direction = raw.direction === "raise_max" ? "max" : "min";
  const current = raw.current_threshold;
  const suggested = raw.suggested_threshold;
  if (current == null || suggested == null || !raw.signal_id) return null;

  const threshMin = direction === "min" ? suggested : null;
  const threshMax = direction === "max" ? suggested : null;

  return {
    id: calibrationSuggestionId(workspaceId, alignment.release_id, raw.signal_id, direction),
    signal_id: raw.signal_id,
    direction,
    current,
    suggested,
    current_threshold: { min: direction === "min" ? current : null, max: direction === "max" ? current : null },
    suggested_threshold: { min: threshMin, max: threshMax },
    confidence: 0.78,
    reason: raw.rationale || `Production was healthy after ${alignment.version || "release"} was blocked — consider loosening this threshold.`,
    fail_rate: 0,
    source: "prod_alignment",
    alignment: "CAUTIOUS",
    release_id: alignment.release_id,
    release_version: alignment.version || null,
    basis_window: {
      type: "prod_alignment",
      alignment: "CAUTIOUS",
      release_id: alignment.release_id,
      computed_at: alignment.computed_at
    }
  };
}

function mapMissTriggerToSuggestion(workspaceId, alignment, signalId, thresh, trigger) {
  if (thresh?.min == null) return null;
  const current = thresh.min;
  const bump = trigger?.outcome === "INCIDENT" ? 0.08 : 0.05;
  const suggested = Math.min(100, +(current * (1 + bump)).toFixed(2));
  if (suggested <= current) return null;

  const outcomeLabel = trigger?.label || alignment.actual_outcome || "degradation in production";
  return {
    id: calibrationSuggestionId(workspaceId, alignment.release_id, signalId, "min"),
    signal_id: signalId,
    direction: "min",
    current,
    suggested,
    current_threshold: { min: current, max: thresh.max ?? null },
    suggested_threshold: { min: suggested, max: thresh.max ?? null },
    confidence: trigger?.outcome === "INCIDENT" ? 0.85 : 0.72,
    reason:
      `Certified release ${alignment.version || alignment.release_id?.slice(0, 8)} had a MISS in production (${outcomeLabel}). ` +
      `Consider raising the ${signalId} floor from ${current} to ${suggested} (+${Math.round(bump * 100)}%).`,
    fail_rate: 0,
    source: "prod_alignment",
    alignment: "MISS",
    release_id: alignment.release_id,
    release_version: alignment.version || null,
    basis_window: {
      type: "prod_alignment",
      alignment: "MISS",
      release_id: alignment.release_id,
      computed_at: alignment.computed_at
    }
  };
}

function missSuggestionsFromAlignment(workspaceId, alignment, threshMap) {
  if (alignment.alignment !== "MISS") return [];

  const triggers = safeJsonParse(alignment.outcome_criteria_json, []);
  const suggestions = [];
  const seen = new Set();

  for (const t of triggers) {
    const signalId = t?.signal || t?.signal_id;
    if (!signalId || seen.has(signalId)) continue;
    const sug = mapMissTriggerToSuggestion(workspaceId, alignment, signalId, threshMap[signalId], t);
    if (sug) {
      suggestions.push(sug);
      seen.add(signalId);
    }
  }

  if (suggestions.length > 0) return suggestions;

  const deltas = safeJsonParse(alignment.signal_deltas_json, {});
  for (const [signalId, d] of Object.entries(deltas)) {
    if (seen.has(signalId)) continue;
    const deltaPct = d?.delta_pct;
    if (deltaPct == null || deltaPct >= -5) continue;
    const sug = mapMissTriggerToSuggestion(workspaceId, alignment, signalId, threshMap[signalId], {
      outcome: alignment.actual_outcome === "INCIDENT" ? "INCIDENT" : "DEGRADED",
      label: `${signalId} dropped ${Math.abs(deltaPct).toFixed(0)}% post-deploy`
    });
    if (sug) {
      suggestions.push(sug);
      seen.add(signalId);
    }
  }

  return suggestions;
}

async function loadDismissedCalibrationIds(workspaceId) {
  return loadDismissedSuggestionKeys(workspaceId);
}

/**
 * Build prod-alignment threshold suggestions from outcome_alignments.
 */
async function buildCalibrationThresholdSuggestions(workspaceId) {
  const [alignments, threshMap, dismissedIds] = await Promise.all([
    queryAll(
      `SELECT oa.*, r.version
       FROM outcome_alignments oa
       JOIN releases r ON r.id = oa.release_id
       WHERE oa.workspace_id = $1 AND oa.alignment IN ('MISS', 'CAUTIOUS')
       ORDER BY oa.computed_at DESC
       LIMIT 40`,
      [workspaceId]
    ),
    getThresholdMap(workspaceId),
    loadDismissedCalibrationIds(workspaceId)
  ]);

  const byKey = new Map();

  for (const alignment of alignments) {
    if (alignment.alignment === "CAUTIOUS") {
      const rawList = safeJsonParse(alignment.over_block_suggestions_json, []);
      for (const raw of rawList) {
        const sug = mapOverBlockRawToSuggestion(workspaceId, alignment, raw);
        if (!sug || isSuggestionDismissed(dismissedIds, sug)) continue;
        const key = `${sug.signal_id}:${sug.direction}`;
        if (!byKey.has(key)) byKey.set(key, sug);
      }
    } else if (alignment.alignment === "MISS") {
      for (const sug of missSuggestionsFromAlignment(workspaceId, alignment, threshMap)) {
        if (isSuggestionDismissed(dismissedIds, sug)) continue;
        const key = `${sug.signal_id}:${sug.direction}`;
        if (!byKey.has(key)) byKey.set(key, sug);
      }
    }
  }

  return Array.from(byKey.values()).sort((a, b) => {
    const pri = (s) => (s.alignment === "MISS" ? 0 : 1);
    const pd = pri(a) - pri(b);
    if (pd !== 0) return pd;
    return String(b.basis_window?.computed_at || "").localeCompare(String(a.basis_window?.computed_at || ""));
  });
}

module.exports = {
  buildCalibrationThresholdSuggestions,
  calibrationSuggestionId,
  missSuggestionsFromAlignment,
  mapOverBlockRawToSuggestion
};
