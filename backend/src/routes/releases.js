"use strict";

const { queryOne, queryAll, run, transaction } = require("../database");
const { getUserRowForAuthById } = require("../services/authUserLookup");

const {
  nowIso,
  writeAudit,
  auditActorFromAuth,
  authMiddleware,
  requireNonViewer,
  requireReleaseAccess,
  requireOverrideApproverRole,
  isAllowedSignalValue,
  evaluateReleaseAfterSignalIngest,
  mapIntegrationSignals,
  releaseVerdictLockedAgainstIngest,
  releaseIngestLockError,
  validateSignalPayload,
  getReleaseIntelligence,
  upsertReleaseIntelligence,
  assessOverrideJustification,
  buildIntelligenceTrace,
  verifyCertificationRecord,
  getCertSignaturePublic,
  signCertificationRecord,
  getEarlyWarning,
  getFailureModes,
  issueStreamToken,
  validateStreamToken,
  attachStream,
  computeAndPersistRecommendation,
  getRecommendation,
  getRecommendationForRelease,
  ingestProductionSignals,
  getProductionObservations,
  computeOutcomeAlignment,
  setIncidentRef,
  openMonitoringWindow,
  scanWindow,
  getMonitoringWindow,
  pullConnectedSourcesForRelease,
  extendCollectionDeadline,
  AI_SIGNAL_DEFINITIONS
} = require("./deps");
const { buildReleaseGateResponse } = require("../services/releaseGate");
const { buildReleaseBriefWithAudit } = require("../services/releaseBrief");
const { createEscalationRequest, notifyEscalationCreated } = require("../services/escalations");
const { applyReleaseOverride } = require("../services/releaseOverride");
const { summarizePullResult } = require("../services/integrationPullStatus");
const { buildReleaseSummary, buildReleaseDetail } = require("../services/releaseDetail");
const { listReleaseAuditEvents } = require("../services/releaseAudit");
const {
  extractIdempotencyKey,
  countSignalsForIdempotencyKey,
  respondToDuplicateSignalIngest
} = require("../services/signalIngestIdempotency");
const { ingestIntegrationSignals, resolveIntegrationIdempotencyKey } = require("../services/signalIngest");

module.exports = function registerReleaseRoutes(app) {
app.post("/api/releases/:releaseId/signals", authMiddleware, requireReleaseAccess, requireNonViewer, async (req, res) => {
  const { source = "manual", signals } = req.body || {};
  if (!signals || typeof signals !== "object") {
    return res.status(400).json({ error: "signals object is required" });
  }
  const release = req.releaseRow;

  // Idempotency: clients may provide X-Idempotency-Key header or body.idempotency_key
  const idempotencyKey = extractIdempotencyKey(req);

  // Schema validation — surface warnings for unrecognised signal names
  const schemaCheck = validateSignalPayload(signals);

  if (idempotencyKey) {
    const existingCount = await countSignalsForIdempotencyKey(req.params.releaseId, idempotencyKey);
    if (existingCount > 0) {
      const out = await respondToDuplicateSignalIngest(release, req.params.releaseId, source, idempotencyKey);
      if (schemaCheck.warnings.length > 0) out.schema_warnings = schemaCheck.warnings;
      return res.json(out);
    }
  }

  if (releaseVerdictLockedAgainstIngest(release)) {
    return res.status(409).json({
      error: releaseIngestLockError(release),
      status: release.status,
      environment: release.environment || null
    });
  }

  const insertSql =
    "INSERT INTO signals (release_id, signal_id, value, source, created_at, idempotency_key) VALUES ($1, $2, $3, $4, $5, $6)";
  const rejected = [];
  let insertedCount = 0;
  await transaction(async (tx) => {
    for (const [signalId, value] of Object.entries(signals)) {
      if (!isAllowedSignalValue(signalId, value)) {
        rejected.push(signalId);
        continue;
      }
      await tx.run(insertSql, [req.params.releaseId, signalId, value, source, nowIso(), idempotencyKey]);
      insertedCount += 1;
    }
  });

  const keyCount = Object.keys(signals).length;
  if (keyCount > 0 && insertedCount === 0) {
    return res.status(400).json({
      error: "no valid signal values after validation (finite numbers, correct ranges per signal type)",
      rejected_signal_ids: rejected,
      schema_warnings: schemaCheck.warnings
    });
  }

  const out = await evaluateReleaseAfterSignalIngest(release, req.params.releaseId, source, insertedCount);
  if (req.auth?.authType === "api_key" && insertedCount > 0) {
    const actor = auditActorFromAuth(req.auth);
    await writeAudit({
      workspaceId: release.workspace_id,
      releaseId: req.params.releaseId,
      eventType: "AGENT_SIGNALS_POSTED",
      actorType: actor.actorType,
      actorName: actor.actorName,
      details: {
        source,
        signal_ids: Object.keys(signals).filter((k) => !rejected.includes(k)),
        inserted_count: insertedCount,
        idempotency_key: idempotencyKey,
        api_key_id: actor.api_key_id
      }
    });
  }
  // Attach schema warnings if any unrecognised signal names were submitted
  if (schemaCheck.warnings.length > 0) out.schema_warnings = schemaCheck.warnings;
  if (idempotencyKey) out.idempotency_key = idempotencyKey;
  return res.json(out);
});

app.post("/api/releases/:releaseId/signals/integrations", authMiddleware, requireReleaseAccess, requireNonViewer, async (req, res) => {
  const { provider = "generic", payload = {}, source } = req.body || {};
  const mapped = mapIntegrationSignals(provider, payload);
  if (!Object.keys(mapped.signals).length) {
    return res.status(400).json({
      error: "no supported numeric signals found in payload",
      supported_signal_ids: Object.keys(AI_SIGNAL_DEFINITIONS).concat(["p95latency", "p99latency"])
    });
  }
  const release = req.releaseRow;
  const ingestSource = typeof source === "string" && source.trim() ? source.trim() : `integration:${String(provider)}`;
  const idempotencyKey = resolveIntegrationIdempotencyKey(req);
  if (idempotencyKey) {
    const existingCount = await countSignalsForIdempotencyKey(release.id, idempotencyKey);
    if (existingCount > 0) {
      const out = await respondToDuplicateSignalIngest(release, release.id, ingestSource, idempotencyKey);
      return res.json({
        ...out,
        inserted_count: 0,
        duplicate: true,
        integration: {
          provider: String(provider),
          mapped_signal_ids: Object.keys(mapped.signals)
        }
      });
    }
  }
  if (releaseVerdictLockedAgainstIngest(release)) {
    return res.status(409).json({
      error: releaseIngestLockError(release),
      status: release.status,
      environment: release.environment || null
    });
  }
  const out = await ingestIntegrationSignals({
    release,
    mappedSignals: mapped.signals,
    source: ingestSource,
    idempotencyKey,
    auditDetails: { provider: String(provider) }
  });
  return res.json({
    ...out,
    integration: {
      provider: String(provider),
      mapped_signal_ids: Object.keys(mapped.signals)
    }
  });
});

/** Pull metrics from workspace-connected sources (Braintrust experiment match by release.version; others may be skipped). */
app.post("/api/releases/:releaseId/sources/pull", authMiddleware, requireReleaseAccess, requireNonViewer, async (req, res) => {
  try {
    const out = await pullConnectedSourcesForRelease(req.releaseRow);
    const summary = summarizePullResult(out, req.releaseRow);
    const actor = auditActorFromAuth(req.auth);
    await writeAudit({
      workspaceId: req.releaseRow.workspace_id,
      releaseId: req.params.releaseId,
      eventType: "SIGNAL_SOURCES_PULL",
      actorType: actor.actorType,
      actorName: actor.actorName,
      details: {
        ok: out.ok,
        sources: out.sources ? Object.keys(out.sources) : [],
        results: summary.results,
        warnings: summary.warnings,
        commit_sha: req.releaseRow.commit_sha || null
      }
    });
    return res.json({ ...out, integration_pull: summary });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
});

app.post("/api/releases/:releaseId/override", authMiddleware, requireReleaseAccess, requireOverrideApproverRole, async (req, res, next) => {
  try {
  const {
    approver_type = "PERSON",
    justification,
    metadata = {}
  } = req.body || {};
  const authUser = await getUserRowForAuthById(req.auth.sub);
  const approver_name = authUser?.name || authUser?.email || req.auth.email;
  const approver_role = authUser?.role || req.auth.role;

  const out = await applyReleaseOverride(req.releaseRow, {
    approver_type,
    approver_name,
    approver_role,
    justification,
    metadata
  });
  if (!out.ok) {
    return res.status(out.statusCode || 400).json({ error: out.error });
  }

  return res.json({
    release_id: out.release_id,
    status: out.status,
    assistive: out.assistive,
    cert_signature: out.cert_signature
  });
  } catch (e) {
    next(e);
  }
});

app.get("/api/releases/:releaseId/summary", authMiddleware, requireReleaseAccess, async (req, res, next) => {
  try {
    return res.json(await buildReleaseSummary(req.releaseRow));
  } catch (e) {
    next(e);
  }
});

app.get("/api/releases/:releaseId/detail", authMiddleware, requireReleaseAccess, async (req, res, next) => {
  try {
    return res.json(await buildReleaseDetail(req.releaseRow));
  } catch (e) {
    next(e);
  }
});

app.get("/api/releases/:releaseId/audit", authMiddleware, requireReleaseAccess, async (req, res, next) => {
  try {
    const { events, next_before } = await listReleaseAuditEvents(req.params.releaseId, {
      limit: req.query.limit,
      before: req.query.before
    });
    return res.json({
      release_id: req.params.releaseId,
      events,
      next_before
    });
  } catch (e) {
    next(e);
  }
});

app.get("/api/releases/:releaseId", authMiddleware, requireReleaseAccess, async (req, res, next) => {
  try {
  const detail = await buildReleaseDetail(req.releaseRow);
  const { events: audit } = await listReleaseAuditEvents(req.params.releaseId, { limit: 50 });

  return res.json({ ...detail, audit });
  } catch (e) {
    next(e);
  }
});

app.get("/api/releases/:releaseId/intelligence", authMiddleware, requireReleaseAccess, async (req, res, next) => {
  try {
  const intelligence = await getReleaseIntelligence(req.params.releaseId);
  return res.json({
    release_id: req.params.releaseId,
    workspace_id: req.releaseRow.workspace_id,
    intelligence: intelligence || {
      verdict: null,
      override: null,
      created_at: null,
      updated_at: null
    }
  });
  } catch (e) {
    next(e);
  }
});

app.get("/api/releases/:releaseId/regression-history", authMiddleware, requireReleaseAccess, async (req, res, next) => {
  try {
    const { computeRegressionHistoryInsights } = require("../services/intelligenceBuilder");
    const release = req.releaseRow;
    const intelligence = await getReleaseIntelligence(req.params.releaseId);
    const verdict = intelligence?.verdict;

    // Extract the signals that failed with a regression kind from stored intelligence
    const failedSignals = verdict?.failed_signals || [];
    const regressionSignalIds = failedSignals
      .filter((s) => s.failure_kind === "regression" || String(s.rule || "").startsWith("regression:"))
      .map((s) => s.signal_id)
      .filter(Boolean);

    // If there's already a regression_history in the stored verdict, return it directly
    if (verdict?.regression_history) {
      return res.json({
        release_id: req.params.releaseId,
        release_type: release.release_type,
        status: release.status,
        regression_history: verdict.regression_history,
        failed_signals: failedSignals.filter((s) => regressionSignalIds.includes(s.signal_id))
      });
    }

    // Otherwise compute on demand (useful for agents that call this before a verdict is cached)
    const candidateIds = regressionSignalIds.length
      ? regressionSignalIds
      : failedSignals.map((s) => s.signal_id).filter(Boolean);

    const history = candidateIds.length
      ? await computeRegressionHistoryInsights(release.workspace_id, req.params.releaseId, release.release_type, candidateIds)
      : null;

    return res.json({
      release_id: req.params.releaseId,
      release_type: release.release_type,
      status: release.status,
      regression_history: history,
      failed_signals: failedSignals.filter((s) => candidateIds.includes(s.signal_id))
    });
  } catch (e) {
    next(e);
  }
});

app.post("/api/releases/:releaseId/intelligence/decision", authMiddleware, requireReleaseAccess, requireNonViewer, async (req, res, next) => {
  try {
  const { decision, notes = "", actor = "user" } = req.body || {};
  const allowed = new Set(["applied", "dismissed", "overridden", "shipped"]);
  if (!allowed.has(String(decision))) {
    return res.status(400).json({ error: "decision must be one of: applied, dismissed, overridden, shipped" });
  }
  const payload = {
    decision: String(decision),
    notes: String(notes || "").slice(0, 2000),
    actor: String(actor || "user"),
    decided_at: nowIso()
  };
  await upsertReleaseIntelligence(req.params.releaseId, req.releaseRow.workspace_id, { decision: payload });
  await writeAudit({
    workspaceId: req.releaseRow.workspace_id,
    releaseId: req.params.releaseId,
    eventType: "INTELLIGENCE_DECISION_RECORDED",
    actorType: "USER",
    actorName: req.auth.email || "user",
    details: payload
  });
  return res.json({ release_id: req.params.releaseId, decision: payload });
  } catch (e) {
    next(e);
  }
});

app.post("/api/releases/:releaseId/intelligence/outcome", authMiddleware, requireReleaseAccess, requireNonViewer, async (req, res, next) => {
  try {
  const { label, notes = "", observed_at } = req.body || {};
  const allowed = new Set(["incident", "no_incident", "followup_met"]);
  if (!allowed.has(String(label))) {
    return res.status(400).json({ error: "label must be one of: incident, no_incident, followup_met" });
  }
  const payload = {
    label: String(label),
    notes: String(notes || "").slice(0, 2000),
    observed_at: typeof observed_at === "string" && observed_at.trim() ? observed_at.trim() : nowIso(),
    recorded_at: nowIso()
  };
  await upsertReleaseIntelligence(req.params.releaseId, req.releaseRow.workspace_id, { outcome: payload });
  const actor = auditActorFromAuth(req.auth);
  await writeAudit({
    workspaceId: req.releaseRow.workspace_id,
    releaseId: req.params.releaseId,
    eventType: "INTELLIGENCE_OUTCOME_RECORDED",
    actorType: actor.actorType,
    actorName: actor.actorName,
    details: payload
  });
  return res.json({ release_id: req.params.releaseId, outcome: payload });
  } catch (e) {
    next(e);
  }
});

app.post("/api/releases/:releaseId/escalate", authMiddleware, requireReleaseAccess, requireNonViewer, async (req, res, next) => {
  try {
    const release = req.releaseRow;
    const { reason, blocking_signals = [], attempted_fixes = [] } = req.body || {};
    const justification = String(reason || "").trim();
    if (!justification) {
      return res.status(400).json({ error: "reason is required" });
    }
    if (release.status === "CERTIFIED" || release.status === "CERTIFIED_WITH_OVERRIDE") {
      return res.status(400).json({ error: "release is already certified; escalation not needed" });
    }

    const actorType = req.auth?.authType === "api_key" ? "AGENT" : "USER";
    const actorName =
      req.auth?.authType === "api_key"
        ? req.auth.apiKeyName || "agent_runtime"
        : req.auth.email || "user";

    await writeAudit({
      workspaceId: release.workspace_id,
      releaseId: req.params.releaseId,
      eventType: "ESCALATION_REQUESTED",
      actorType,
      actorName,
      details: {
        reason: justification.slice(0, 2000),
        blocking_signals: Array.isArray(blocking_signals) ? blocking_signals : [],
        attempted_fixes: Array.isArray(attempted_fixes) ? attempted_fixes : [],
        status: release.status
      }
    });

    const { escalation, reused } = await createEscalationRequest({
      workspaceId: release.workspace_id,
      releaseId: req.params.releaseId,
      reason: justification,
      blockingSignals: Array.isArray(blocking_signals) ? blocking_signals : [],
      attemptedFixes: Array.isArray(attempted_fixes) ? attempted_fixes : [],
      requestedByType: actorType,
      requestedByName: actorName,
      releaseStatus: release.status
    });

    void notifyEscalationCreated({
      workspaceId: release.workspace_id,
      releaseId: req.params.releaseId,
      escalation,
      releaseRow: release
    }).catch((err) => {
      console.error("[escalation_email]", req.params.releaseId, err);
    });

    return res.status(202).json({
      release_id: req.params.releaseId,
      status: release.status,
      escalation: {
        id: escalation.id,
        state: escalation.state,
        reason: escalation.reason,
        sla_due_at: escalation.sla_due_at,
        reused
      }
    });
  } catch (e) {
    next(e);
  }
});

app.get("/api/releases/:releaseId/gate", authMiddleware, requireReleaseAccess, async (req, res, next) => {
  try {
    const mode =
      req.query.mode === "strict"
        ? "strict"
        : req.query.mode === "default"
          ? "default"
          : undefined;
    const payload = await buildReleaseGateResponse(req.releaseRow, { mode, auth: req.auth });
    return res.json(payload);
  } catch (e) {
    next(e);
  }
});

app.get("/api/releases/:releaseId/release-brief", authMiddleware, requireReleaseAccess, async (req, res, next) => {
  try {
    const mode =
      req.query.mode === "strict"
        ? "strict"
        : req.query.mode === "default"
          ? "default"
          : undefined;
    const payload = await buildReleaseBriefWithAudit(req.releaseRow, { mode, auth: req.auth });
    return res.json(payload);
  } catch (e) {
    next(e);
  }
});

// ─── Certification Signing ────────────────────────────────────────────────────

/** Public: verify a certification record's cryptographic signature. No auth required. */
app.get("/api/releases/:releaseId/cert/verify", async (req, res, next) => {
  try {
    const result = await verifyCertificationRecord(req.params.releaseId);
    const sig = await getCertSignaturePublic(req.params.releaseId);
    return res.json({ release_id: req.params.releaseId, verification: result, signature: sig });
  } catch (e) {
    next(e);
  }
});

/** Public: get the cert signature record for embedding in badges. */
app.get("/api/releases/:releaseId/cert/signature", async (req, res, next) => {
  try {
    const sig = await getCertSignaturePublic(req.params.releaseId);
    if (!sig) return res.status(404).json({ error: "no signature on record for this release" });
    return res.json(sig);
  } catch (e) {
    next(e);
  }
});
// ─── Early Warnings ───────────────────────────────────────────────────────────

app.get("/api/releases/:releaseId/early-warning", authMiddleware, requireReleaseAccess, async (req, res, next) => {
  try {
    const ew = await getEarlyWarning(req.params.releaseId);
    if (!ew) return res.status(404).json({ error: "no early warning computed for this release yet" });
    return res.json(ew);
  } catch (e) {
    next(e);
  }
});
app.get("/api/releases/:releaseId/failure-modes", authMiddleware, requireReleaseAccess, async (req, res, next) => {
  try {
    const modes = await getFailureModes(req.params.releaseId);
    return res.json({ release_id: req.params.releaseId, failure_modes: modes });
  } catch (e) {
    next(e);
  }
});
/** Extend the collection deadline while a release is still COLLECTING. */
app.post(
  "/api/releases/:releaseId/collection-deadline/extend",
  authMiddleware,
  requireNonViewer,
  requireReleaseAccess,
  async (req, res, next) => {
    try {
      const { extend_minutes: extendMinutes } = req.body || {};
      const result = await extendCollectionDeadline(req.releaseRow, extendMinutes);
      return res.json({ release_id: req.params.releaseId, ...result });
    } catch (e) {
      if (e.status === 409) return res.status(409).json({ error: e.message });
      next(e);
    }
  }
);

// ─── SSE Real-time Stream ─────────────────────────────────────────────────────

/** Issue a short-lived token to open an SSE stream. */
app.post("/api/releases/:releaseId/sse-token", authMiddleware, requireReleaseAccess, requireNonViewer, async (req, res, next) => {
  try {
    const { token, expires_at } = await issueStreamToken(req.params.releaseId, req.auth.ws);
    return res.json({ token, expires_at, stream_url: `/api/releases/${req.params.releaseId}/stream` });
  } catch (e) {
    next(e);
  }
});

/** SSE stream endpoint — token-authenticated (no Bearer needed, for EventSource compat). */
app.get("/api/releases/:releaseId/stream", async (req, res) => {
  const { token } = req.query;
  const { valid, reason } = await validateStreamToken(token, req.params.releaseId);
  if (!valid) return res.status(401).json({ error: `Unauthorized: ${reason || "invalid_token"}` });
  attachStream(req.params.releaseId, res);
});
/** Allow setting commit_sha and pr_number on a release (for VCS write-back). */
app.patch("/api/releases/:releaseId/vcs-context", authMiddleware, requireReleaseAccess, requireNonViewer, async (req, res, next) => {
  try {
  const { commit_sha, pr_number } = req.body || {};
  if (!commit_sha && !pr_number) return res.status(400).json({ error: "commit_sha or pr_number is required" });
  await run(
    "UPDATE releases SET commit_sha = COALESCE($1, commit_sha), pr_number = COALESCE($2, pr_number), updated_at = $3 WHERE id = $4",
    [commit_sha || null, pr_number || null, nowIso(), req.params.releaseId]
  );
  return res.json({ release_id: req.params.releaseId, commit_sha, pr_number });
  } catch (e) {
    next(e);
  }
});
// ─── Recommendation Engine ────────────────────────────────────────────────────

/** Get the structured recommendation for a release (cached from last verdict). */
app.get("/api/releases/:releaseId/recommendation", authMiddleware, requireReleaseAccess, async (req, res, next) => {
  try {
    const rec = await getRecommendationForRelease(req.releaseRow);
    if (!rec) return res.status(404).json({ error: "no recommendation computed for this release yet" });
    return res.json({ release_id: req.params.releaseId, ...rec });
  } catch (e) {
    next(e);
  }
});

/** Force-recompute a recommendation for a release (e.g. after reliability scores are updated). */
app.post("/api/releases/:releaseId/recommendation/compute", authMiddleware, requireReleaseAccess, requireNonViewer, async (req, res, next) => {
  try {
    const rec = await computeAndPersistRecommendation(req.releaseRow);
    return res.json({ release_id: req.params.releaseId, ...rec });
  } catch (err) {
    next(err);
  }
});
// ─── Production Feedback Loop ─────────────────────────────────────────────────

/**
 * POST /api/releases/:releaseId/production-signals
 * Ingest post-deployment production metric observations (idempotent).
 * Body: { signals: { signal_name: value }, source?, idempotency_key?, metadata? }
 * Header: X-Idempotency-Key (alternative to body field)
 */
app.post("/api/releases/:releaseId/production-signals", authMiddleware, requireReleaseAccess, requireNonViewer, async (req, res, next) => {
  try {
  const { signals, source, idempotency_key: bodyKey, metadata } = req.body || {};
  const releaseId = req.params.releaseId;
  const workspaceId = req.releaseRow.workspace_id;

  if (!signals || typeof signals !== "object" || Array.isArray(signals)) {
    return res.status(400).json({ error: "signals object is required" });
  }

  const idempotencyKey = req.headers["x-idempotency-key"] || bodyKey || null;

  const result = await ingestProductionSignals(releaseId, workspaceId, signals, {
    source: source || "webhook",
    idempotencyKey,
    metadata: metadata || null
  });

  if (result.inserted.length === 0 && result.duplicates.length > 0) {
    return res.status(409).json({
      error: "duplicate_request",
      message: "All signals already recorded under this idempotency key.",
      idempotency_key: idempotencyKey,
      duplicates: result.duplicates
    });
  }

  return res.json({
    release_id: releaseId,
    inserted: result.inserted,
    duplicates: result.duplicates,
    errors: result.errors,
    idempotency_key: idempotencyKey
  });
  } catch (e) {
    next(e);
  }
});

/**
 * GET /api/releases/:releaseId/production-signals
 * Retrieve production observations for a specific release.
 */
app.get("/api/releases/:releaseId/production-signals", authMiddleware, requireReleaseAccess, async (req, res, next) => {
  try {
  const observations = await getProductionObservations(req.params.releaseId);
  return res.json({ release_id: req.params.releaseId, observations });
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/releases/:releaseId/production-signals/align
 * Manually trigger outcome alignment computation for a release.
 */
app.post("/api/releases/:releaseId/production-signals/align", authMiddleware, requireReleaseAccess, requireNonViewer, async (req, res, next) => {
  try {
  const result = await computeOutcomeAlignment(req.params.releaseId, req.releaseRow.workspace_id);
  if (!result) return res.status(422).json({ error: "No production observations found for this release yet." });
  return res.json(result);
  } catch (e) {
    next(e);
  }
});

/**
 * PUT /api/releases/:releaseId/production-signals/incident
 * Link a post-mortem incident reference to a release's outcome alignment.
 * Body: { incident_ref: string }  — any string (Jira, PagerDuty, URL, etc.)
 */
app.put("/api/releases/:releaseId/production-signals/incident", authMiddleware, requireReleaseAccess, requireNonViewer, async (req, res, next) => {
  try {
  const { incident_ref } = req.body || {};
  if (!incident_ref || typeof incident_ref !== "string" || !incident_ref.trim()) {
    return res.status(400).json({ error: "incident_ref (non-empty string) is required" });
  }
  const result = await setIncidentRef(req.params.releaseId, req.releaseRow.workspace_id, incident_ref.trim());
  return res.json(result);
  } catch (e) {
    next(e);
  }
});
// ─── VCS Automatic Production Monitoring ─────────────────────────────────────

/**
 * GET /api/releases/:releaseId/vcs-monitor
 * Get the VCS monitoring window status for a specific release.
 */
app.get("/api/releases/:releaseId/vcs-monitor", authMiddleware, requireReleaseAccess, async (req, res, next) => {
  try {
  const window = await getMonitoringWindow(req.params.releaseId);
  if (!window) return res.status(404).json({ error: "No monitoring window found for this release." });
  return res.json(window);
  } catch (e) {
    next(e);
  }
});

/**
 * POST /api/releases/:releaseId/vcs-monitor/scan
 * Manually trigger an immediate VCS scan for a release (useful for testing).
 */
app.post("/api/releases/:releaseId/vcs-monitor/scan", authMiddleware, requireReleaseAccess, requireNonViewer, async (req, res) => {
  let window = await getMonitoringWindow(req.params.releaseId);

  // If no window exists yet, open one from the release's current state
  if (!window) {
    const release = req.releaseRow;
    await openMonitoringWindow(release, 120);
    window = await getMonitoringWindow(req.params.releaseId);
  }

  if (!window || window.status === "no_sha") {
    return res.status(422).json({ error: "Release has no commit_sha — VCS monitoring requires a commit SHA." });
  }
  if (window.status === "no_vcs") {
    return res.status(422).json({ error: "No VCS integration configured for this workspace. Connect GitHub or GitLab in settings." });
  }

  try {
    const newStatus = await scanWindow(window);
    return res.json({ release_id: req.params.releaseId, status: newStatus, window: await getMonitoringWindow(req.params.releaseId) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
};
