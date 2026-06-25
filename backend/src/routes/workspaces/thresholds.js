"use strict";

const { run, transaction } = require("../../database");
const {
  writeAudit,
  authMiddleware,
  requireHumanSession,
  requireNonViewer,
  requireWorkspaceMatch,
  getThresholdMap,
  buildThresholdSuggestions,
  maybeEnrichSuggestionReason,
  simulateThresholds,
  ENABLE_THRESHOLD_SUGGESTIONS
} = require("../deps");
const { buildCalibrationThresholdSuggestions } = require("../../services/calibrationSuggestions");
const { buildGateCalibrationContext } = require("../../services/gateCalibrationContext");
const { applyThresholdSuggestion } = require("../../services/thresholdSuggestionApply");
const { recordSuggestionDismissal } = require("../../services/thresholdSuggestionDismissals");

module.exports = function registerRoutes(app) {
app.get("/api/workspaces/:workspaceId/thresholds", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const thresholds = await getThresholdMap(req.params.workspaceId);
    res.json({ workspace_id: req.params.workspaceId, thresholds });
  } catch (e) {
    next(e);
  }
});

app.post("/api/workspaces/:workspaceId/thresholds", authMiddleware, requireHumanSession, requireWorkspaceMatch, requireNonViewer, async (req, res, next) => {
  try {
    const { thresholds } = req.body || {};
    if (!thresholds || typeof thresholds !== "object") {
      return res.status(400).json({ error: "thresholds object is required" });
    }
    const upsertSql =
      "INSERT INTO thresholds (workspace_id, signal_id, min_value, max_value, required_for_certification) VALUES ($1, $2, $3, $4, $5) ON CONFLICT(workspace_id, signal_id) DO UPDATE SET min_value=excluded.min_value, max_value=excluded.max_value, required_for_certification=excluded.required_for_certification";
    await transaction(async (tx) => {
      for (const [signalId, t] of Object.entries(thresholds)) {
        const required = t?.required_for_certification === true || t?.required_for_certification === 1 ? 1 : 0;
        await tx.run(upsertSql, [req.params.workspaceId, signalId, t.min ?? null, t.max ?? null, required]);
      }
    });
    await writeAudit({
      workspaceId: req.params.workspaceId,
      eventType: "THRESHOLDS_UPDATED",
      actorType: "USER",
      actorName: "workspace_admin",
      details: { signal_count: Object.keys(thresholds).length }
    });
    return res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

app.get("/api/workspaces/:workspaceId/threshold-suggestions", authMiddleware, requireWorkspaceMatch, async (req, res) => {
  if (!ENABLE_THRESHOLD_SUGGESTIONS) {
    return res.status(404).json({ error: "threshold suggestions disabled" });
  }
  const out = await buildThresholdSuggestions(req.params.workspaceId);
  const enrichResults = await Promise.allSettled(
    out.suggestions.map((suggestion) => maybeEnrichSuggestionReason(suggestion, { window: out.window }))
  );
  let ai_reasoning_used = false;
  const suggestions = out.suggestions.map((suggestion, i) => {
    const r = enrichResults[i];
    let nextReason = suggestion.reason;
    if (r.status === "fulfilled" && r.value && r.value !== suggestion.reason) {
      ai_reasoning_used = true;
      nextReason = r.value;
    }
    return { ...suggestion, reason: nextReason };
  });
  await writeAudit({
    workspaceId: req.params.workspaceId,
    eventType: "THRESHOLD_SUGGESTED",
    actorType: "SYSTEM",
    actorName: "threshold_engine",
    details: {
      count: out.suggestions.length,
      suggestion_ids: suggestions.map((s) => s.id),
      analysis_window: out.window,
      ai_reasoning_used
    }
  });
  await writeAudit({
    workspaceId: req.params.workspaceId,
    eventType: "THRESHOLD_SUGGESTIONS_VIEWED",
    actorType: "USER",
    actorName: "workspace_admin",
    details: { count: suggestions.length, analysis_window: out.window }
  });
  return res.json({
    workspace_id: req.params.workspaceId,
    analysis_window: out.window,
    suggestions
  });
});

/** Prod-alignment calibration suggestions only (MISS / CAUTIOUS). Same apply/dismiss IDs as threshold-suggestions. */
app.get("/api/workspaces/:workspaceId/calibration-suggestions", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    if (!ENABLE_THRESHOLD_SUGGESTIONS) {
      return res.status(404).json({ error: "threshold suggestions disabled" });
    }
    const suggestions = await buildCalibrationThresholdSuggestions(req.params.workspaceId);
    const context = await buildGateCalibrationContext(req.params.workspaceId);
    return res.json({
      workspace_id: req.params.workspaceId,
      mode: "suggest_only",
      apply_on: "/thresholds",
      suggestions,
      context
    });
  } catch (e) {
    next(e);
  }
});

app.post("/api/workspaces/:workspaceId/threshold-suggestions/:suggestionId/apply", authMiddleware, requireHumanSession, requireWorkspaceMatch, requireNonViewer, async (req, res, next) => {
  try {
    if (!ENABLE_THRESHOLD_SUGGESTIONS) {
      return res.status(404).json({ error: "threshold suggestions disabled" });
    }
    const { suggestionId } = req.params;
    const out = await buildThresholdSuggestions(req.params.workspaceId);
    const sug = out.suggestions.find((s) => s.id === suggestionId);
    if (!sug) return res.status(404).json({ error: "suggestion not found" });

    await applyThresholdSuggestion(req.params.workspaceId, sug, {
      actorType: "USER",
      actorName: "workspace_admin",
      basis_window: sug.basis_window || out.window
    });
    return res.json({ ok: true, applied: sug });
  } catch (e) {
    next(e);
  }
});

app.post("/api/workspaces/:workspaceId/threshold-suggestions/:suggestionId/dismiss", authMiddleware, requireHumanSession, requireWorkspaceMatch, requireNonViewer, async (req, res, next) => {
  try {
    if (!ENABLE_THRESHOLD_SUGGESTIONS) {
      return res.status(404).json({ error: "threshold suggestions disabled" });
    }
    const { suggestionId } = req.params;
    const { reason = "not_now" } = req.body || {};
    const out = await buildThresholdSuggestions(req.params.workspaceId);
    const sug = out.suggestions.find((s) => s.id === suggestionId);
    if (!sug) return res.status(404).json({ error: "suggestion not found" });

    await recordSuggestionDismissal(req.params.workspaceId, sug, reason);

    await writeAudit({
      workspaceId: req.params.workspaceId,
      eventType: "THRESHOLD_SUGGESTION_DISMISSED",
      actorType: "USER",
      actorName: "workspace_admin",
      details: {
        suggestion_id: suggestionId,
        signal_id: sug.signal_id,
        direction: sug.direction,
        current: sug.current,
        suggested: sug.suggested,
        reason: typeof reason === "string" ? reason : "not_now"
      }
    });
    return res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
app.post("/api/workspaces/:workspaceId/thresholds/simulate", authMiddleware, requireWorkspaceMatch, requireNonViewer, async (req, res, next) => {
  try {
    const { proposed_thresholds, release_ids, limit } = req.body || {};

    if (!proposed_thresholds || typeof proposed_thresholds !== "object" || Array.isArray(proposed_thresholds)) {
      return res.status(400).json({ error: "proposed_thresholds object is required" });
    }
    if (Object.keys(proposed_thresholds).length === 0) {
      return res.status(400).json({ error: "proposed_thresholds must contain at least one signal rule" });
    }

    const result = await simulateThresholds(req.params.workspaceId, proposed_thresholds, {
      limit: typeof limit === "number" ? Math.min(limit, 200) : 50,
      releaseIds: Array.isArray(release_ids) ? release_ids : null
    });

    return res.json(result);
  } catch (e) {
    next(e);
  }
});
};
