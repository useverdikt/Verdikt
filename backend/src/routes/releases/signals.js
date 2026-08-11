"use strict";

const {
  sendError,
  writeAudit,
  auditActorFromAuth,
  authMiddleware,
  requireHumanSession,
  requireNonViewer,
  requireReleaseAccess,
  isAllowedSignalValue,
  mapIntegrationSignals,
  releaseVerdictLockedAgainstIngest,
  releaseIngestLockError,
  validateSignalPayload,
  signalIngestRateLimit,
  pullConnectedSourcesForRelease,
  extendCollectionDeadline,
  AI_SIGNAL_DEFINITIONS,
  summarizePullResult,
  extractIdempotencyKey,
  countSignalsForIdempotencyKey,
  respondToDuplicateSignalIngest,
  ingestReleaseSignals,
  ingestIntegrationSignals,
  resolveIntegrationIdempotencyKey
} = require("./_shared");

module.exports = function registerRoutes(app) {
  app.post("/api/releases/:releaseId/signals", authMiddleware, requireReleaseAccess, requireNonViewer, signalIngestRateLimit, async (req, res) => {
    const { source = "manual", signals } = req.body || {};
    if (!signals || typeof signals !== "object") {
      return sendError(res, req, 400, "signals object is required");
    }
    const release = req.releaseRow;

    // Idempotency: clients may provide X-Idempotency-Key header or body.idempotency_key
    const idempotencyKey = extractIdempotencyKey(req);

    // Schema validation — surface warnings for unrecognised signal names
    const schemaCheck = validateSignalPayload(signals);

    // A duplicate idempotency key replays as a read-only response regardless of
    // the release's current verdict-lock state — it never re-evaluates or audits,
    // so it must be served before the lock check below. The transactional
    // INSERT ... ON CONFLICT DO NOTHING later in this handler is the race-proof
    // backstop that catches the narrow window where two concurrent first-time
    // requests both pass this pre-check.
    if (idempotencyKey) {
      const existingCount = await countSignalsForIdempotencyKey(req.params.releaseId, idempotencyKey);
      if (existingCount > 0) {
        const out = await respondToDuplicateSignalIngest(release, req.params.releaseId, source, idempotencyKey);
        if (schemaCheck.warnings.length > 0) out.schema_warnings = schemaCheck.warnings;
        return res.json(out);
      }
    }

    if (releaseVerdictLockedAgainstIngest(release)) {
      return sendError(res, req, 409, releaseIngestLockError(release), {
        details: {
          status: release.status,
          environment: release.environment || null
        }
      });
    }

    const ingestResult = await ingestReleaseSignals({
      release,
      signals,
      source,
      idempotencyKey,
      validateSignal: isAllowedSignalValue
    });
    if (ingestResult.kind === "duplicate") {
      const out = ingestResult.response;
      if (schemaCheck.warnings.length > 0) out.schema_warnings = schemaCheck.warnings;
      return res.json(out);
    }
    if (ingestResult.kind === "no_valid_signals") {
      return sendError(res, req, 400, "no valid signal values after validation (finite numbers, correct ranges per signal type)", {
        details: {
          rejected_signal_ids: ingestResult.rejectedSignalIds,
          schema_warnings: schemaCheck.warnings
        }
      });
    }

    const out = ingestResult.response;
    const insertedCount = ingestResult.insertedCount;
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
          signal_ids: ingestResult.acceptedSignalIds,
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

  app.post("/api/releases/:releaseId/signals/integrations", authMiddleware, requireReleaseAccess, requireNonViewer, signalIngestRateLimit, async (req, res) => {
    const { provider = "generic", payload = {}, source } = req.body || {};
    const mapped = mapIntegrationSignals(provider, payload);
    if (!Object.keys(mapped.signals).length) {
      return sendError(res, req, 400, "no supported numeric signals found in payload", {
        details: {
          supported_signal_ids: Object.keys(AI_SIGNAL_DEFINITIONS).concat(["p95latency", "p99latency"])
        }
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
      return sendError(res, req, 409, releaseIngestLockError(release), {
        details: {
          status: release.status,
          environment: release.environment || null
        }
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
  app.post("/api/releases/:releaseId/sources/pull", authMiddleware, requireReleaseAccess, requireNonViewer, async (req, res, next) => {
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
      next(err);
    }
  });


  app.post(
    "/api/releases/:releaseId/collection-deadline/extend",
    authMiddleware,
    requireHumanSession,
    requireNonViewer,
    requireReleaseAccess,
    async (req, res, next) => {
      try {
        const { extend_minutes: extendMinutes } = req.body || {};
        const result = await extendCollectionDeadline(req.releaseRow, extendMinutes);
        return res.json({ release_id: req.params.releaseId, ...result });
      } catch (e) {
        if (e.status === 409) return sendError(res, req, 409, e.message);
        next(e);
      }
    }
  );
};
