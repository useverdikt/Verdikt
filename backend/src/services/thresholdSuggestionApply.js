"use strict";

/**
 * Shared threshold-suggestion apply logic (human UI, API, and opt-in auto-apply).
 */

const { run } = require("../database");
const { writeAudit } = require("./audit");
const { getThresholdMap } = require("./workspaceConfig");

/**
 * Apply a single threshold suggestion row to workspace thresholds.
 *
 * @param {string} workspaceId
 * @param {object} sug – suggestion object from thresholdAdvisor / calibrationSuggestions
 * @param {object} auditMeta – { actorType, actorName, basis_window? }
 */
async function applyThresholdSuggestion(workspaceId, sug, auditMeta = {}) {
  const thresholdMap = await getThresholdMap(workspaceId);
  const currentThreshold = thresholdMap[sug.signal_id] || { min: null, max: null };
  const nextMin = sug.direction === "min" ? sug.suggested : currentThreshold.min;
  const nextMax = sug.direction === "max" ? sug.suggested : currentThreshold.max;

  await run(
    "INSERT INTO thresholds (workspace_id, signal_id, min_value, max_value, required_for_certification) VALUES (?, ?, ?, ?, ?) ON CONFLICT(workspace_id, signal_id) DO UPDATE SET min_value=excluded.min_value, max_value=excluded.max_value",
    [
      workspaceId,
      sug.signal_id,
      nextMin,
      nextMax,
      currentThreshold.required_for_certification ? 1 : 0
    ]
  );

  await writeAudit({
    workspaceId,
    eventType: "THRESHOLD_SUGGESTION_APPLIED",
    actorType: auditMeta.actorType || "USER",
    actorName: auditMeta.actorName || "workspace_admin",
    details: {
      suggestion_id: sug.id,
      signal_id: sug.signal_id,
      direction: sug.direction,
      previous: currentThreshold,
      applied: { min: nextMin, max: nextMax },
      confidence: sug.confidence,
      basis_window: sug.basis_window || auditMeta.basis_window || null,
      source: sug.source || "signal_history",
      alignment: sug.alignment || null,
      release_id: sug.release_id || null,
      release_version: sug.release_version || null,
      auto_applied: auditMeta.auto_applied === true
    }
  });

  return { applied: sug, previous: currentThreshold, next: { min: nextMin, max: nextMax } };
}

module.exports = { applyThresholdSuggestion };
