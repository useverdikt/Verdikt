"use strict";

const { queryOne, queryAll, run, transaction } = require("../database");
const { getUserRowForAuthById } = require("../services/authUserLookup");

const {
  nowIso,
  writeAudit,
  auditActorFromAuth,
  listReleaseDeltas,
  authMiddleware,
  requireNonViewer,
  requireReleaseAccess,
  requireOverrideApproverRole,
  isAllowedSignalValue,
  evaluateReleaseAfterSignalIngest,
  mapIntegrationSignals,
  releaseVerdictLockedAgainstIngest,
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
  ingestProductionSignals,
  getProductionObservations,
  getOutcomeAlignmentForRelease,
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
const { createEscalationRequest, notifyEscalationCreated } = require("../services/escalations");
const { applyReleaseOverride } = require("../services/releaseOverride");
const {
  getLatestIntegrationPullForRelease,
  summarizePullResult
} = require("../services/integrationPullStatus");
const {
  resolveEvidenceForRelease,
  persistReleaseEvidenceQuality
} = require("../services/evidenceQuality");

const CERT_LIKE_STATUSES = new Set(["CERTIFIED", "CERTIFIED_WITH_OVERRIDE", "UNCERTIFIED"]);

module.exports = function registerReleaseRoutes(app) {
app.post("/api/releases/:releaseId/signals", authMiddleware, requireNonViewer, requireReleaseAccess, async (req, res) => {
  const { source = "manual", signals } = req.body || {};
  if (!signals || typeof signals !== "object") {
    return res.status(400).json({ error: "signals object is required" });
  }
  const release = req.releaseRow;
  if (releaseVerdictLockedAgainstIngest(release)) {
    return res.status(409).json({
      error: "release verdict is locked after certification; further signal ingest is not accepted",
      status: release.status
    });
  }

  // Idempotency: clients may provide X-Idempotency-Key header or body.idempotency_key
  const idempotencyKey = (
    req.headers["x-idempotency-key"] ||
    req.body?.idempotency_key ||
    null
  );

  // Schema validation — surface warnings for unrecognised signal names
  const schemaCheck = validateSignalPayload(signals);

  // Check idempotency: if key provided and all signals already exist under that key → 409
  if (idempotencyKey) {
    const countRow = await queryOne(
      "SELECT COUNT(*) AS c FROM signals WHERE release_id = ? AND idempotency_key = ?",
      [req.params.releaseId, idempotencyKey]
    );
    const existingCount = Number(countRow?.c ?? 0);
    if (existingCount > 0) {
      return res.status(409).json({
        error: "duplicate_request",
        message: "Signals for this idempotency key were already ingested. Returning original result.",
        idempotency_key: idempotencyKey,
        release_id: req.params.releaseId
      });
    }
  }

  const insertSql =
    "INSERT INTO signals (release_id, signal_id, value, source, created_at, idempotency_key) VALUES (?, ?, ?, ?, ?, ?)";
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

app.post("/api/releases/:releaseId/signals/integrations", authMiddleware, requireNonViewer, requireReleaseAccess, async (req, res) => {
  const { provider = "generic", payload = {}, source } = req.body || {};
  const mapped = mapIntegrationSignals(provider, payload);
  if (!Object.keys(mapped.signals).length) {
    return res.status(400).json({
      error: "no supported numeric signals found in payload",
      supported_signal_ids: Object.keys(AI_SIGNAL_DEFINITIONS).concat(["p95latency", "p99latency"])
    });
  }
  const release = req.releaseRow;
  if (releaseVerdictLockedAgainstIngest(release)) {
    return res.status(409).json({
      error: "release verdict is locked after certification; further signal ingest is not accepted",
      status: release.status
    });
  }
  const insertIntSql =
    "INSERT INTO signals (release_id, signal_id, value, source, created_at) VALUES (?, ?, ?, ?, ?)";
  const ingestSource = typeof source === "string" && source.trim() ? source.trim() : `integration:${String(provider)}`;
  await transaction(async (tx) => {
    for (const [signalId, value] of Object.entries(mapped.signals)) {
      await tx.run(insertIntSql, [req.params.releaseId, signalId, value, ingestSource, nowIso()]);
    }
  });

  await writeAudit({
    workspaceId: release.workspace_id,
    releaseId: req.params.releaseId,
    eventType: "INTEGRATION_SIGNALS_MAPPED",
    actorType: "SYSTEM",
    actorName: ingestSource,
    details: {
      provider: String(provider),
      mapped_signal_ids: Object.keys(mapped.signals)
    }
  });

  const out = await evaluateReleaseAfterSignalIngest(release, req.params.releaseId, ingestSource, Object.keys(mapped.signals).length);
  return res.json({
    ...out,
    integration: {
      provider: String(provider),
      mapped_signal_ids: Object.keys(mapped.signals)
    }
  });
});

/** Pull metrics from workspace-connected sources (Braintrust experiment match by release.version; others may be skipped). */
app.post("/api/releases/:releaseId/sources/pull", authMiddleware, requireNonViewer, requireReleaseAccess, async (req, res) => {
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

app.get("/api/releases/:releaseId", authMiddleware, requireReleaseAccess, async (req, res, next) => {
  try {
  let release = req.releaseRow;
  const signalRows = await queryAll(
    "SELECT id, signal_id, value, source, created_at FROM signals WHERE release_id = ? ORDER BY id DESC",
    [req.params.releaseId]
  );
  const override = await queryOne("SELECT * FROM overrides WHERE release_id = ?", [req.params.releaseId]);
  const overrideHistoryRows = await queryAll(
    "SELECT id, release_id, approver_type, approver_name, approver_role, justification, metadata_json, created_at FROM override_history WHERE release_id = ? ORDER BY id ASC",
    [req.params.releaseId]
  );
  const lastEvalRow = await queryOne(
    `SELECT details_json FROM audit_events
       WHERE release_id = ? AND event_type = 'SIGNALS_INGESTED'
       ORDER BY id DESC LIMIT 1`,
    [req.params.releaseId]
  );
  let last_signal_evaluation = null;
  if (lastEvalRow) {
    try {
      const d = JSON.parse(lastEvalRow.details_json || "{}");
      last_signal_evaluation = {
        threshold_failed_signals: Array.isArray(d.threshold_failed_signals) ? d.threshold_failed_signals : undefined,
        missing_signals: Array.isArray(d.missing_signals) ? d.missing_signals : undefined,
        failed_signals: Array.isArray(d.failed_signals) ? d.failed_signals : undefined,
        computed_status: d.computed_status
      };
    } catch {
      last_signal_evaluation = null;
    }
  }
  const auditRows = await queryAll(
    "SELECT event_type, actor_type, actor_name, details_json, created_at FROM audit_events WHERE release_id = ? ORDER BY id DESC",
    [req.params.releaseId]
  );
  const audit = auditRows.map((e) => ({ ...e, details: JSON.parse(e.details_json || "{}") }));
  const intelligence = await getReleaseIntelligence(req.params.releaseId);
  const deltas = await listReleaseDeltas(req.params.releaseId);
  const outcome_alignment = await getOutcomeAlignmentForRelease(req.params.releaseId);
  const integration_pull = await getLatestIntegrationPullForRelease(req.params.releaseId);
  const connectedIntegrations = await queryAll(
    "SELECT source_id FROM signal_integrations WHERE workspace_id = ?",
    [release.workspace_id]
  );

  let evidence_quality = release.evidence_quality ?? null;
  let evidence_summary = null;
  ({ evidence_quality, evidence_summary } = resolveEvidenceForRelease(release, signalRows));

  if (
    !release.evidence_quality &&
    CERT_LIKE_STATUSES.has(String(release.status || "").toUpperCase()) &&
    signalRows.length > 0
  ) {
    try {
      const persisted = await persistReleaseEvidenceQuality(req.params.releaseId);
      evidence_quality = persisted.evidence_quality;
      evidence_summary = persisted.evidence_summary;
      release = { ...release, evidence_quality, evidence_summary_json: JSON.stringify(evidence_summary) };
    } catch (_) {}
  }

  return res.json({
    release: {
      ...release,
      ai_context: JSON.parse(release.ai_context_json || "{}"),
      evidence_quality,
      evidence_summary
    },
    signals: signalRows,
    deltas,
    connected_integrations: connectedIntegrations.map((r) => r.source_id),
    integration_pull,
    override: override
      ? {
          ...override,
          metadata: JSON.parse(override.metadata_json || "{}"),
          updated_at: override.updated_at || override.created_at
        }
      : null,
    override_history: overrideHistoryRows.map((row) => ({
      ...row,
      metadata: JSON.parse(row.metadata_json || "{}")
    })),
    last_signal_evaluation,
    intelligence,
    outcome_alignment,
    audit
  });
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

app.post("/api/releases/:releaseId/intelligence/decision", authMiddleware, requireNonViewer, requireReleaseAccess, async (req, res, next) => {
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

app.post("/api/releases/:releaseId/intelligence/outcome", authMiddleware, requireNonViewer, requireReleaseAccess, async (req, res, next) => {
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

app.post("/api/releases/:releaseId/escalate", authMiddleware, requireNonViewer, requireReleaseAccess, async (req, res, next) => {
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
app.post("/api/releases/:releaseId/sse-token", authMiddleware, requireNonViewer, requireReleaseAccess, async (req, res, next) => {
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
app.patch("/api/releases/:releaseId/vcs-context", authMiddleware, requireNonViewer, requireReleaseAccess, async (req, res, next) => {
  try {
  const { commit_sha, pr_number } = req.body || {};
  if (!commit_sha && !pr_number) return res.status(400).json({ error: "commit_sha or pr_number is required" });
  await run(
    "UPDATE releases SET commit_sha = COALESCE(?, commit_sha), pr_number = COALESCE(?, pr_number), updated_at = ? WHERE id = ?",
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
    const rec = await getRecommendation(req.params.releaseId);
    if (!rec) return res.status(404).json({ error: "no recommendation computed for this release yet" });
    return res.json({ release_id: req.params.releaseId, ...rec });
  } catch (e) {
    next(e);
  }
});

/** Force-recompute a recommendation for a release (e.g. after reliability scores are updated). */
app.post("/api/releases/:releaseId/recommendation/compute", authMiddleware, requireNonViewer, requireReleaseAccess, async (req, res, next) => {
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
app.post("/api/releases/:releaseId/production-signals", authMiddleware, requireNonViewer, requireReleaseAccess, async (req, res, next) => {
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
app.post("/api/releases/:releaseId/production-signals/align", authMiddleware, requireNonViewer, requireReleaseAccess, async (req, res, next) => {
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
app.put("/api/releases/:releaseId/production-signals/incident", authMiddleware, requireNonViewer, requireReleaseAccess, async (req, res, next) => {
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
app.post("/api/releases/:releaseId/vcs-monitor/scan", authMiddleware, requireNonViewer, requireReleaseAccess, async (req, res) => {
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
