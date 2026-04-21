"use strict";

const { run, transaction, queryOne, queryAll } = require("../database");

const {
  nowIso,
  toIsoPlusMinutes,
  writeAudit,
  authMiddleware,
  requireNonViewer,
  requireWorkspaceMatch,
  getThresholdMap,
  getWorkspacePolicy,
  buildThresholdSuggestions,
  maybeEnrichSuggestionReason,
  verifyAuditIntegrity,
  getBaselinePolicy,
  setBaselinePolicy,
  getOutboundWebhook,
  setOutboundWebhook,
  deleteOutboundWebhook,
  validateSignalPayload,
  getSignalSchema,
  computeAndPersistCorrelations,
  getCorrelations,
  getFailureModeTrends,
  computeAndPersistRecommendation,
  upsertEnvChain,
  listEnvChains,
  deleteEnvChain,
  getChainStatus,
  getVcsIntegration,
  setVcsIntegration,
  deleteVcsIntegration,
  computeOverrideAnalytics,
  computeSignalReliability,
  getSignalReliability,
  getReliabilitySummary,
  getWorkspaceProductionHealth,
  OUTCOME_CRITERIA,
  simulateThresholds,
  getWorkspaceMonitoringSummary,
  upsertIntegration,
  listIntegrations,
  deleteIntegration,
  importCsv,
  getLatestCsvImport,
  deleteCsvImports,
  signalCsvUpload,
  applyCsvImportToWorkspace,
  ALLOWED_RELEASE_TYPES,
  DEFAULT_COLLECTION_WINDOW_MINUTES,
  ENABLE_THRESHOLD_SUGGESTIONS
} = require("./deps");

module.exports = function registerWorkspaceRoutes(app) {
app.get("/api/workspaces/:workspaceId/thresholds", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const thresholds = await getThresholdMap(req.params.workspaceId);
    res.json({ workspace_id: req.params.workspaceId, thresholds });
  } catch (e) {
    next(e);
  }
});

app.post("/api/workspaces/:workspaceId/thresholds", authMiddleware, requireNonViewer, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const { thresholds } = req.body || {};
    if (!thresholds || typeof thresholds !== "object") {
      return res.status(400).json({ error: "thresholds object is required" });
    }
    const upsertSql =
      "INSERT INTO thresholds (workspace_id, signal_id, min_value, max_value) VALUES (?, ?, ?, ?) ON CONFLICT(workspace_id, signal_id) DO UPDATE SET min_value=excluded.min_value, max_value=excluded.max_value";
    await transaction(async (tx) => {
      for (const [signalId, t] of Object.entries(thresholds)) {
        await tx.run(upsertSql, [req.params.workspaceId, signalId, t.min ?? null, t.max ?? null]);
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

app.post("/api/workspaces/:workspaceId/threshold-suggestions/:suggestionId/apply", authMiddleware, requireNonViewer, requireWorkspaceMatch, async (req, res, next) => {
  try {
    if (!ENABLE_THRESHOLD_SUGGESTIONS) {
      return res.status(404).json({ error: "threshold suggestions disabled" });
    }
    const { suggestionId } = req.params;
    const out = await buildThresholdSuggestions(req.params.workspaceId);
    const sug = out.suggestions.find((s) => s.id === suggestionId);
    if (!sug) return res.status(404).json({ error: "suggestion not found" });

    const thresholdMap = await getThresholdMap(req.params.workspaceId);
    const currentThreshold = thresholdMap[sug.signal_id] || { min: null, max: null };
    const nextMin = sug.direction === "min" ? sug.suggested : currentThreshold.min;
    const nextMax = sug.direction === "max" ? sug.suggested : currentThreshold.max;
    await run(
      "INSERT INTO thresholds (workspace_id, signal_id, min_value, max_value) VALUES (?, ?, ?, ?) ON CONFLICT(workspace_id, signal_id) DO UPDATE SET min_value=excluded.min_value, max_value=excluded.max_value",
      [req.params.workspaceId, sug.signal_id, nextMin, nextMax]
    );

    await writeAudit({
      workspaceId: req.params.workspaceId,
      eventType: "THRESHOLD_SUGGESTION_APPLIED",
      actorType: "USER",
      actorName: "workspace_admin",
      details: {
        suggestion_id: suggestionId,
        signal_id: sug.signal_id,
        direction: sug.direction,
        previous: currentThreshold,
        applied: { min: nextMin, max: nextMax },
        confidence: sug.confidence,
        basis_window: sug.basis_window || out.window
      }
    });
    return res.json({ ok: true, applied: sug });
  } catch (e) {
    next(e);
  }
});

app.post("/api/workspaces/:workspaceId/threshold-suggestions/:suggestionId/dismiss", authMiddleware, requireNonViewer, requireWorkspaceMatch, async (req, res, next) => {
  try {
    if (!ENABLE_THRESHOLD_SUGGESTIONS) {
      return res.status(404).json({ error: "threshold suggestions disabled" });
    }
    const { suggestionId } = req.params;
    const { reason = "not_now" } = req.body || {};
    const out = await buildThresholdSuggestions(req.params.workspaceId);
    const sug = out.suggestions.find((s) => s.id === suggestionId);
    if (!sug) return res.status(404).json({ error: "suggestion not found" });

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

app.get("/api/workspaces/:workspaceId/policies", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const policy = await getWorkspacePolicy(req.params.workspaceId);
    return res.json({
      workspace_id: req.params.workspaceId,
      policies: {
        require_ai_eval: policy.require_ai_eval === 1,
        ai_missing_policy: policy.ai_missing_policy
      }
    });
  } catch (e) {
    next(e);
  }
});

app.post("/api/workspaces/:workspaceId/policies", authMiddleware, requireNonViewer, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const current = await getWorkspacePolicy(req.params.workspaceId);
    const { require_ai_eval, ai_missing_policy } = req.body || {};
    const nextRequireAi = typeof require_ai_eval === "boolean" ? (require_ai_eval ? 1 : 0) : current.require_ai_eval;
    const nextMissingPolicy =
      typeof ai_missing_policy === "string" && ["block_uncertified", "allow_without_ai"].includes(ai_missing_policy)
        ? ai_missing_policy
        : current.ai_missing_policy;
    await run(
      "UPDATE workspace_policies SET require_ai_eval = ?, ai_missing_policy = ?, updated_at = ? WHERE workspace_id = ?",
      [nextRequireAi, nextMissingPolicy, nowIso(), req.params.workspaceId]
    );
    await writeAudit({
      workspaceId: req.params.workspaceId,
      eventType: "POLICY_UPDATED",
      actorType: "USER",
      actorName: "workspace_admin",
      details: { require_ai_eval: nextRequireAi === 1, ai_missing_policy: nextMissingPolicy }
    });
    return res.json({ ok: true, policies: { require_ai_eval: nextRequireAi === 1, ai_missing_policy: nextMissingPolicy } });
  } catch (e) {
    next(e);
  }
});

app.get("/api/workspaces/:workspaceId/releases", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const ws = req.params.workspaceId;
    const countRow = await queryOne("SELECT COUNT(*) AS c FROM releases WHERE workspace_id = ?", [ws]);
    const total_count = Number(countRow?.c ?? 0);
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || "50"), 10) || 50));
    const before = typeof req.query.before === "string" && req.query.before.trim() ? req.query.before.trim() : null;
    const rows = before
      ? await queryAll(
          `SELECT id, workspace_id, version, release_type, environment, status, created_at, updated_at, release_ref, trigger_source, collection_deadline, verdict_issued_at
           FROM releases WHERE workspace_id = ? AND created_at::timestamptz < ?::timestamptz
           ORDER BY created_at::timestamptz DESC LIMIT ?`,
          [ws, before, limit]
        )
      : await queryAll(
          `SELECT id, workspace_id, version, release_type, environment, status, created_at, updated_at, release_ref, trigger_source, collection_deadline, verdict_issued_at
           FROM releases WHERE workspace_id = ? ORDER BY created_at::timestamptz DESC LIMIT ?`,
          [ws, limit]
        );
    const last = rows[rows.length - 1];
    const next_before = rows.length === limit && last ? last.created_at : null;
    return res.json({
      workspace_id: ws,
      total_count,
      limit,
      next_before,
      has_more: !!next_before,
      releases: rows
    });
  } catch (e) {
    next(e);
  }
});

app.post("/api/workspaces/:workspaceId/releases", authMiddleware, requireNonViewer, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const {
      version,
      release_type = "model_update",
      environment = "pre-prod",
      ai_context = {},
      commit_sha = null,
      pr_number = null
    } = req.body || {};
    if (!version) return res.status(400).json({ error: "version is required" });
    if (typeof ai_context !== "object" || Array.isArray(ai_context)) {
      return res.status(400).json({ error: "ai_context must be an object" });
    }
    if (!ALLOWED_RELEASE_TYPES.has(release_type)) {
      return res.status(400).json({
        error: "release_type must be one of: prompt_update, model_patch, safety_patch, policy_change, model_update"
      });
    }

    const releaseId = `rel_${Date.now()}`;
    const now = nowIso();
    const deadline = toIsoPlusMinutes(DEFAULT_COLLECTION_WINDOW_MINUTES);
    await run(
      `INSERT INTO releases (
      id, workspace_id, version, release_type, environment, status, created_at, updated_at,
      release_ref, trigger_source, mappings_json, collection_deadline, verdict_issued_at, ai_context_json, commit_sha, pr_number
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        releaseId,
        req.params.workspaceId,
        version,
        release_type,
        environment,
        "COLLECTING",
        now,
        now,
        version,
        "manual",
        "{}",
        deadline,
        null,
        JSON.stringify(ai_context || {}),
        commit_sha || null,
        pr_number || null
      ]
    );

    await writeAudit({
      workspaceId: req.params.workspaceId,
      releaseId,
      eventType: "RELEASE_CREATED",
      actorType: "USER",
      actorName: "release_owner",
      details: { version, release_type, environment, ai_context, commit_sha: commit_sha || null, pr_number: pr_number || null }
    });

    return res.status(201).json({
      id: releaseId,
      workspace_id: req.params.workspaceId,
      version,
      release_type,
      environment,
      commit_sha: commit_sha || null,
      pr_number: pr_number || null,
      status: "COLLECTING",
      collection_deadline: deadline
    });
  } catch (e) {
    next(e);
  }
});

app.get("/api/workspaces/:workspaceId/audit", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const raw = await queryAll(
      "SELECT event_type, actor_type, actor_name, release_id, details_json, created_at FROM audit_events WHERE workspace_id = ? ORDER BY id DESC LIMIT 200",
      [req.params.workspaceId]
    );
    const rows = raw.map((e) => ({ ...e, details: JSON.parse(e.details_json || "{}") }));
    return res.json({ workspace_id: req.params.workspaceId, events: rows });
  } catch (e) {
    next(e);
  }
});
// ─── Audit Integrity ──────────────────────────────────────────────────────────

/** Authenticated: verify audit log integrity for a workspace. */
app.get("/api/workspaces/:workspaceId/audit/integrity", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const result = await verifyAuditIntegrity(req.params.workspaceId);
    return res.json({ workspace_id: req.params.workspaceId, ...result });
  } catch (e) {
    next(e);
  }
});

// ─── Baseline Policy ──────────────────────────────────────────────────────────

app.get("/api/workspaces/:workspaceId/baseline-policy", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const policy = await getBaselinePolicy(req.params.workspaceId);
    return res.json(policy);
  } catch (e) {
    next(e);
  }
});

app.put("/api/workspaces/:workspaceId/baseline-policy", authMiddleware, requireNonViewer, requireWorkspaceMatch, async (req, res, next) => {
  try {
  const { strategy, window_n, pinned_release_id } = req.body || {};
  try {
    await setBaselinePolicy(req.params.workspaceId, { strategy, window_n, pinned_release_id });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  const policy = await getBaselinePolicy(req.params.workspaceId);
  writeAudit({
    workspaceId: req.params.workspaceId,
    eventType: "BASELINE_POLICY_UPDATED",
    actorType: "USER",
    actorName: req.auth?.email || "user",
    details: { strategy, window_n, pinned_release_id }
  });
  return res.json(policy);
  } catch (e) {
    next(e);
  }
});

// ─── Outbound Webhook ─────────────────────────────────────────────────────────

app.get("/api/workspaces/:workspaceId/outbound-webhook", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const hook = await getOutboundWebhook(req.params.workspaceId);
    if (!hook) return res.status(404).json({ error: "no outbound webhook configured" });
    // Mask secret
    const safe = { ...hook, secret: hook.secret ? "***" : null };
    return res.json(safe);
  } catch (e) {
    next(e);
  }
});

app.put("/api/workspaces/:workspaceId/outbound-webhook", authMiddleware, requireNonViewer, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const { url, secret, events } = req.body || {};
    if (!url || typeof url !== "string") return res.status(400).json({ error: "url is required" });
    try {
      new URL(url);
    } catch {
      return res.status(400).json({ error: "url must be a valid URL" });
    }
    await setOutboundWebhook(req.params.workspaceId, { url, secret, events });
    writeAudit({
      workspaceId: req.params.workspaceId,
      eventType: "OUTBOUND_WEBHOOK_CONFIGURED",
      actorType: "USER",
      actorName: req.auth?.email || "user",
      details: { url, events }
    });
    const hook = await getOutboundWebhook(req.params.workspaceId);
    return res.json({ ...hook, secret: hook?.secret ? "***" : null });
  } catch (e) {
    next(e);
  }
});

app.delete("/api/workspaces/:workspaceId/outbound-webhook", authMiddleware, requireNonViewer, requireWorkspaceMatch, async (req, res, next) => {
  try {
    await deleteOutboundWebhook(req.params.workspaceId);
    writeAudit({
      workspaceId: req.params.workspaceId,
      eventType: "OUTBOUND_WEBHOOK_REMOVED",
      actorType: "USER",
      actorName: req.auth?.email || "user",
      details: {}
    });
    return res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ─── Signal Schema ────────────────────────────────────────────────────────────

app.get("/api/workspaces/:workspaceId/signal-schema", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const schema = await getSignalSchema(req.params.workspaceId);
    return res.json({ workspace_id: req.params.workspaceId, signals: schema });
  } catch (e) {
    next(e);
  }
});

/** Validate a signal payload without ingesting it (dry-run). */
app.post("/api/workspaces/:workspaceId/signal-schema/validate", authMiddleware, requireNonViewer, requireWorkspaceMatch, (req, res) => {
  const { signals } = req.body || {};
  const result = validateSignalPayload(signals);
  return res.json(result);
});

// ─── Signal Correlation ───────────────────────────────────────────────────────

app.post("/api/workspaces/:workspaceId/correlations/compute", authMiddleware, requireNonViewer, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const { window_n = 20 } = req.body || {};
    const result = await computeAndPersistCorrelations(req.params.workspaceId, Math.min(50, Math.max(5, Number(window_n))));
    return res.json({ workspace_id: req.params.workspaceId, ...result });
  } catch (e) {
    next(e);
  }
});

app.get("/api/workspaces/:workspaceId/correlations", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const minAbs = Math.min(1, Math.max(0, Number(req.query.min_abs || 0.3)));
    const rows = await getCorrelations(req.params.workspaceId, minAbs);
    return res.json({ workspace_id: req.params.workspaceId, correlations: rows });
  } catch (e) {
    next(e);
  }
});

app.get("/api/workspaces/:workspaceId/failure-mode-trends", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const trends = await getFailureModeTrends(req.params.workspaceId);
    return res.json({ workspace_id: req.params.workspaceId, trends });
  } catch (e) {
    next(e);
  }
});
app.get("/api/workspaces/:workspaceId/env-chains", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    return res.json({ workspace_id: req.params.workspaceId, chains: await listEnvChains(req.params.workspaceId) });
  } catch (e) {
    next(e);
  }
});

app.post("/api/workspaces/:workspaceId/env-chains", authMiddleware, requireNonViewer, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const { name, environments, require_all } = req.body || {};
    if (!name || !environments) return res.status(400).json({ error: "name and environments are required" });
    try {
      const chain = await upsertEnvChain(req.params.workspaceId, { name, environments, require_all });
      writeAudit({
        workspaceId: req.params.workspaceId,
        eventType: "ENV_CHAIN_CONFIGURED",
        actorType: "USER",
        actorName: req.auth?.email || "user",
        details: { name, environments }
      });
      return res.status(201).json(chain);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  } catch (e) {
    next(e);
  }
});

app.get("/api/workspaces/:workspaceId/env-chains/:chainId", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const status = await getChainStatus(req.params.chainId);
    if (!status) return res.status(404).json({ error: "chain not found" });
    return res.json(status);
  } catch (e) {
    next(e);
  }
});

app.delete("/api/workspaces/:workspaceId/env-chains/:chainId", authMiddleware, requireNonViewer, requireWorkspaceMatch, async (req, res, next) => {
  try {
    await deleteEnvChain(req.params.chainId);
    return res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
app.get("/api/workspaces/:workspaceId/vcs-integration", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const cfg = await getVcsIntegration(req.params.workspaceId);
    if (!cfg) return res.status(404).json({ error: "no VCS integration configured" });
    return res.json({ ...cfg, access_token: "***" });
  } catch (e) {
    next(e);
  }
});

app.put("/api/workspaces/:workspaceId/vcs-integration", authMiddleware, requireNonViewer, requireWorkspaceMatch, async (req, res, next) => {
  try {
  const { provider, access_token, owner, repo } = req.body || {};
  try {
    await setVcsIntegration(req.params.workspaceId, { provider, access_token, owner, repo });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  writeAudit({ workspaceId: req.params.workspaceId, eventType: "VCS_INTEGRATION_CONFIGURED", actorType: "USER", actorName: req.auth?.email || "user", details: { provider, owner, repo } });
  const cfg = await getVcsIntegration(req.params.workspaceId);
  return res.json({ ...cfg, access_token: "***" });
  } catch (e) {
    next(e);
  }
});

app.delete("/api/workspaces/:workspaceId/vcs-integration", authMiddleware, requireNonViewer, requireWorkspaceMatch, async (req, res, next) => {
  try {
  await deleteVcsIntegration(req.params.workspaceId);
  writeAudit({ workspaceId: req.params.workspaceId, eventType: "VCS_INTEGRATION_REMOVED", actorType: "USER", actorName: req.auth?.email || "user", details: {} });
  return res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ─── Signal source integrations (Braintrust, LangSmith, Sentry, Datadog) + CSV ─

app.get("/api/workspaces/:workspaceId/signal-integrations", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const integrations = await listIntegrations(req.params.workspaceId);
    const csv_import = await getLatestCsvImport(req.params.workspaceId);
  return res.json({
    workspace_id: req.params.workspaceId,
    integrations,
    csv_import
  });
  } catch (e) {
    next(e);
  }
});

app.put("/api/workspaces/:workspaceId/signal-integrations/:sourceId", authMiddleware, requireNonViewer, requireWorkspaceMatch, async (req, res) => {
  try {
    const out = await upsertIntegration(req.params.workspaceId, req.params.sourceId, req.body || {});
    writeAudit({
      workspaceId: req.params.workspaceId,
      eventType: "SIGNAL_SOURCE_CONNECTED",
      actorType: "USER",
      actorName: req.auth?.email || "user",
      details: { source_id: req.params.sourceId }
    });
    return res.json(out);
  } catch (err) {
    return res.status(400).json({ error: err.message || String(err) });
  }
});

app.delete("/api/workspaces/:workspaceId/signal-integrations/:sourceId", authMiddleware, requireNonViewer, requireWorkspaceMatch, async (req, res) => {
  try {
    const ok = await deleteIntegration(req.params.workspaceId, req.params.sourceId);
    if (!ok) return res.status(404).json({ error: "integration not found" });
    writeAudit({
      workspaceId: req.params.workspaceId,
      eventType: "SIGNAL_SOURCE_DISCONNECTED",
      actorType: "USER",
      actorName: req.auth?.email || "user",
      details: { source_id: req.params.sourceId }
    });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(400).json({ error: err.message || String(err) });
  }
});

app.post(
  "/api/workspaces/:workspaceId/signal-csv-imports",
  authMiddleware,
  requireNonViewer,
  requireWorkspaceMatch,
  signalCsvUpload.single("file"),
  async (req, res) => {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'file is required (multipart field name "file")' });
    }
    try {
      const out = await importCsv(req.params.workspaceId, req.file.buffer, req.file.originalname);
      writeAudit({
        workspaceId: req.params.workspaceId,
        eventType: "SIGNAL_CSV_IMPORTED",
        actorType: "USER",
        actorName: req.auth?.email || "user",
        details: { import_id: out.import_id, row_count: out.row_count, filename: out.filename }
      });
      const applyResult = await applyCsvImportToWorkspace(req.params.workspaceId, out.import_id);
      return res.json({ ...out, apply_result: applyResult });
    } catch (err) {
      return res.status(400).json({ error: err.message || String(err) });
    }
  }
);

app.delete("/api/workspaces/:workspaceId/signal-csv-imports", authMiddleware, requireNonViewer, requireWorkspaceMatch, async (req, res, next) => {
  try {
  await deleteCsvImports(req.params.workspaceId);
  writeAudit({
    workspaceId: req.params.workspaceId,
    eventType: "SIGNAL_CSV_CLEARED",
    actorType: "USER",
    actorName: req.auth?.email || "user",
    details: {}
  });
  return res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
// ─── Override Analytics ───────────────────────────────────────────────────────

app.get("/api/workspaces/:workspaceId/override-analytics", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const result = await computeOverrideAnalytics(req.params.workspaceId);
    return res.json(result);
  } catch (e) {
    next(e);
  }
});

// ─── Signal Reliability ───────────────────────────────────────────────────────

app.post("/api/workspaces/:workspaceId/signal-reliability/compute", authMiddleware, requireNonViewer, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const { window_n = 20 } = req.body || {};
    const results = await computeSignalReliability(req.params.workspaceId, Math.min(50, Math.max(3, Number(window_n))));
    return res.json({ workspace_id: req.params.workspaceId, signals: results });
  } catch (e) {
    next(e);
  }
});

app.get("/api/workspaces/:workspaceId/signal-reliability", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const signals = await getSignalReliability(req.params.workspaceId);
    const summary = await getReliabilitySummary(req.params.workspaceId);
    return res.json({ workspace_id: req.params.workspaceId, summary, signals });
  } catch (e) {
    next(e);
  }
});
/**
 * Backfill recommendations for all completed releases in a workspace that
 * don't have one yet. Safe to run multiple times (idempotent).
 */
app.post("/api/workspaces/:workspaceId/recommendations/backfill", authMiddleware, requireNonViewer, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const VERDICTED = ["CERTIFIED", "UNCERTIFIED", "CERTIFIED_WITH_OVERRIDE"];
    const releases = await queryAll(
      `SELECT * FROM releases WHERE workspace_id = ? AND status IN (${VERDICTED.map(() => "?").join(",")})`,
      [req.params.workspaceId, ...VERDICTED]
    );

    let computed = 0;
    let skipped = 0;
    const errors = [];

    for (const release of releases) {
      try {
        await computeAndPersistRecommendation(release);
        computed++;
      } catch (err) {
        errors.push({ release_id: release.id, error: err.message });
        skipped++;
      }
    }

    return res.json({
      workspace_id: req.params.workspaceId,
      total: releases.length,
      computed,
      skipped,
      errors: errors.slice(0, 10)
    });
  } catch (e) {
    next(e);
  }
});
app.get("/api/workspaces/:workspaceId/production-health", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    return res.json(await getWorkspaceProductionHealth(req.params.workspaceId));
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/workspaces/:workspaceId/production-health/criteria
 * Returns the exact heuristic thresholds used to classify production outcomes.
 * Surfaces Fix #1: users can see exactly why MISS/HEALTHY/INCIDENT was assigned.
 */
app.get("/api/workspaces/:workspaceId/production-health/criteria", authMiddleware, requireWorkspaceMatch, (_req, res) => {
  return res.json({ outcome_classification_criteria: OUTCOME_CRITERIA });
});
app.get("/api/workspaces/:workspaceId/loop-readiness", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
  const wsId = req.params.workspaceId;
  const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
  const eligibleCutoff = new Date(Date.now() - THREE_HOURS_MS).toISOString();

  // All releases in this workspace
  const trRow = await queryOne("SELECT COUNT(*) AS c FROM releases WHERE workspace_id = ?", [wsId]);
  const totalReleases = Number(trRow?.c ?? 0);

  // Releases with a verdict issued (regardless of age)
  const viRow = await queryOne(
    "SELECT COUNT(*) AS c FROM releases WHERE workspace_id = ? AND verdict_issued_at IS NOT NULL",
    [wsId]
  );
  const verdictIssued = Number(viRow?.c ?? 0);

  // Eligible releases: verdict issued more than 3 hours ago
  const elRow = await queryOne(
    `SELECT COUNT(*) AS c FROM releases
              WHERE workspace_id = ? AND verdict_issued_at IS NOT NULL
              AND verdict_issued_at::timestamptz <= ?::timestamptz`,
    [wsId, eligibleCutoff]
  );
  const eligible = Number(elRow?.c ?? 0);

  // Eligible releases that have at least one production observation
  const woRow = await queryOne(
    `SELECT COUNT(DISTINCT po.release_id) AS c
              FROM production_observations po
              JOIN releases r ON r.id = po.release_id
              WHERE r.workspace_id = ?
              AND r.verdict_issued_at IS NOT NULL
              AND r.verdict_issued_at::timestamptz <= ?::timestamptz`,
    [wsId, eligibleCutoff]
  );
  const withObservations = Number(woRow?.c ?? 0);

  // Eligible releases with a computed alignment (full loop = verdict + observation + alignment)
  const waRow = await queryOne(
    `SELECT COUNT(DISTINCT oa.release_id) AS c
              FROM outcome_alignments oa
              JOIN releases r ON r.id = oa.release_id
              WHERE r.workspace_id = ?
              AND r.verdict_issued_at IS NOT NULL
              AND r.verdict_issued_at::timestamptz <= ?::timestamptz`,
    [wsId, eligibleCutoff]
  );
  const withAlignment = Number(waRow?.c ?? 0);

  const fullLoopCount = withAlignment; // alignment implies verdict + observation + alignment
  const fullLoopRatePct = eligible > 0 ? Math.round((fullLoopCount / eligible) * 100) : 0;

  // Age of the most recent full loop
  const lastLoopRow = await queryOne(
    `SELECT oa.computed_at
              FROM outcome_alignments oa
              JOIN releases r ON r.id = oa.release_id
              WHERE r.workspace_id = ?
              AND r.verdict_issued_at IS NOT NULL
              AND r.verdict_issued_at::timestamptz <= ?::timestamptz
              ORDER BY oa.computed_at::timestamptz DESC
              LIMIT 1`,
    [wsId, eligibleCutoff]
  );
  const lastFullLoopAt = lastLoopRow?.computed_at ?? null;
  const lastFullLoopDaysAgo = lastFullLoopAt
    ? Math.floor((Date.now() - Date.parse(lastFullLoopAt)) / (24 * 60 * 60 * 1000))
    : null;

  // Quality band (thresholds locked — do not adjust to improve optics)
  let band;
  if (fullLoopCount < 10) {
    band = "Exploratory";
  } else if (fullLoopCount <= 50) {
    band = "Emerging";
  } else {
    band = fullLoopRatePct >= 60 ? "Reliable" : "Emerging";
  }

  // Stale: any band, no full loop in 90 days
  const isStale = lastFullLoopDaysAgo !== null && lastFullLoopDaysAgo > 90;

  // Has observations but no full loops (VCS integration working but alignment not triggering)
  const observationsWithoutAlignment = Math.max(0, withObservations - withAlignment);

  return res.json({
    workspace_id: wsId,
    band,                          // "Exploratory" | "Emerging" | "Reliable"
    is_stale: isStale,             // true if last full loop > 90 days ago
    // Counts
    total_releases: totalReleases,
    verdict_issued: verdictIssued,
    eligible_releases: eligible,   // verdict > 3 hours old
    with_production_observations: withObservations,
    with_alignment: withAlignment,
    full_loop_count: fullLoopCount,
    full_loop_rate_pct: fullLoopRatePct,
    observations_without_alignment: observationsWithoutAlignment,
    // Recency
    last_full_loop_at: lastFullLoopAt,
    last_full_loop_days_ago: lastFullLoopDaysAgo,
    // Thresholds (surfaced for transparency — these are fixed)
    band_thresholds: {
      exploratory_max: 9,
      emerging_max: 50,
      reliable_min_loops: 51,
      reliable_min_rate_pct: 60,
      stale_threshold_days: 90
    },
    // Activation guidance
    next_action: fullLoopCount === 0 && verdictIssued === 0
      ? "Start by creating a release candidate and ingesting signals."
      : fullLoopCount === 0 && withObservations === 0
      ? "Connect your VCS integration to start automatic post-deploy monitoring."
      : fullLoopCount === 0
      ? "Production observations are arriving — alignment will compute automatically."
      : fullLoopCount < 10
      ? `${10 - fullLoopCount} more full loop${10 - fullLoopCount !== 1 ? "s" : ""} to reach Emerging.`
      : fullLoopCount <= 50
      ? `${51 - fullLoopCount} more full loop${51 - fullLoopCount !== 1 ? "s" : ""} to reach Reliable (requires 60%+ rate).`
      : isStale
      ? "Loop history exists but no recent loops — check your VCS monitoring windows."
      : "Feedback loop is healthy. Confidence scores are being calibrated against production reality."
  });
  } catch (e) {
    next(e);
  }
});
app.get("/api/workspaces/:workspaceId/vcs-monitor", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    return res.json(await getWorkspaceMonitoringSummary(req.params.workspaceId));
  } catch (e) {
    next(e);
  }
});
app.post("/api/workspaces/:workspaceId/thresholds/simulate", authMiddleware, requireNonViewer, requireWorkspaceMatch, async (req, res, next) => {
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
