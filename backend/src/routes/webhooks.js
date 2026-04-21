"use strict";

const crypto = require("crypto");

const { queryOne, run, transaction } = require("../database");
const config = require("../config");
const { nowIso, toIsoPlusMinutes } = require("../lib/time");
const { writeAudit } = require("../services/audit");
const { webhookRateLimit } = require("../middleware/rateLimit");
const { verifyInboundWebhookSignature } = require("../services/inboundWebhookSecrets");
const {
  evaluateReleaseAfterSignalIngest,
  mapIntegrationSignals,
  releaseVerdictLockedAgainstIngest,
  resolveReleaseForWorkspaceIngest
} = require("../services/domain");

const { AI_SIGNAL_DEFINITIONS, ALLOWED_RELEASE_TYPES, DEFAULT_COLLECTION_WINDOW_MINUTES } = config;

module.exports = function registerWebhookRoutes(app) {
app.post("/api/hooks/release-promoted", webhookRateLimit, async (req, res, next) => {
  try {
  if (!(await verifyInboundWebhookSignature(req))) {
    console.warn(`[${req.requestId}] invalid webhook signature`);
    return res.status(401).json({ error: "Invalid webhook signature" });
  }
  const {
    workspace_id,
    release_ref,
    release_type = "model_update",
    environment = "pre-prod",
    source = "webhook",
    mappings = {},
    ai_context = {},
    collection_window_minutes = DEFAULT_COLLECTION_WINDOW_MINUTES,
    idempotency_key
  } = req.body || {};

  if (!workspace_id || !release_ref) {
    return res.status(400).json({ error: "workspace_id and release_ref are required" });
  }
  if (typeof mappings !== "object" || Array.isArray(mappings)) {
    return res.status(400).json({ error: "mappings must be an object" });
  }
  if (typeof source !== "string" || source.trim().length === 0) {
    return res.status(400).json({ error: "source must be a non-empty string" });
  }
  if (typeof ai_context !== "object" || Array.isArray(ai_context)) {
    return res.status(400).json({ error: "ai_context must be an object" });
  }
  if (!ALLOWED_RELEASE_TYPES.has(release_type)) {
    return res.status(400).json({
      error: "release_type must be one of: prompt_update, model_patch, safety_patch, policy_change, model_update"
    });
  }

  const key =
    idempotency_key ||
    (typeof req.headers["x-idempotency-key"] === "string" ? req.headers["x-idempotency-key"] : null) ||
    `${workspace_id}:${release_ref}:${source}`;
  const existing = await queryOne("SELECT release_id FROM webhook_events WHERE idempotency_key = ?", [key]);
  if (existing) {
    const release = await queryOne("SELECT * FROM releases WHERE id = ?", [existing.release_id]);
    console.log(`[${req.requestId}] webhook replay`, { idempotency_key: key, release_id: existing.release_id });
    return res.status(200).json({ ok: true, reused: true, release });
  }

  const releaseId = `rel_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
  const now = nowIso();
  const windowMins = Number.isFinite(+collection_window_minutes) ? Math.max(5, Math.min(24 * 60, +collection_window_minutes)) : DEFAULT_COLLECTION_WINDOW_MINUTES;
  const deadline = toIsoPlusMinutes(windowMins);
  await run(
    `INSERT INTO releases (
      id, workspace_id, version, release_type, environment, status, created_at, updated_at,
      release_ref, trigger_source, mappings_json, collection_deadline, verdict_issued_at, ai_context_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      releaseId,
      workspace_id,
      release_ref,
      release_type,
      environment,
      "COLLECTING",
      now,
      now,
      release_ref,
      source,
      JSON.stringify(mappings || {}),
      deadline,
      null,
      JSON.stringify(ai_context || {})
    ]
  );
  await run("INSERT INTO webhook_events (idempotency_key, release_id, created_at) VALUES (?, ?, ?)", [
    key,
    releaseId,
    now
  ]);
  await writeAudit({
    workspaceId: workspace_id,
    releaseId,
    eventType: "RELEASE_TRIGGERED",
    actorType: "SYSTEM",
    actorName: source,
    details: { release_ref, mappings, ai_context, collection_window_minutes: windowMins }
  });
  console.log(`[${req.requestId}] release triggered`, { release_id: releaseId, workspace_id, release_ref, source });
  return res.status(201).json({
    id: releaseId,
    workspace_id,
    release_ref,
    release_type,
    environment,
    status: "COLLECTING",
    collection_deadline: deadline
  });
  } catch (e) {
    next(e);
  }
});

app.post("/api/workspaces/:workspaceId/integrations/evals", webhookRateLimit, async (req, res, next) => {
  try {
  if (!(await verifyInboundWebhookSignature(req, req.params.workspaceId))) {
    return res.status(401).json({ error: "Invalid webhook signature" });
  }
  const { provider = "generic", payload = {}, source, release_id, release_ref, version } = req.body || {};
  const release = await resolveReleaseForWorkspaceIngest(req.params.workspaceId, { release_id, release_ref, version });
  if (!release) {
    return res.status(404).json({ error: "release not found for workspace", hint: "provide release_id, release_ref, or version" });
  }
  if (releaseVerdictLockedAgainstIngest(release)) {
    return res.status(409).json({
      error: "release verdict is locked after certification; further signal ingest is not accepted",
      status: release.status,
      release_id: release.id
    });
  }
  const mapped = mapIntegrationSignals(provider, payload);
  if (!Object.keys(mapped.signals).length) {
    return res.status(400).json({
      error: "no supported numeric signals found in payload",
      supported_signal_ids: Object.keys(AI_SIGNAL_DEFINITIONS).concat(["p95latency", "p99latency"])
    });
  }
  const insertHookSql =
    "INSERT INTO signals (release_id, signal_id, value, source, created_at) VALUES (?, ?, ?, ?, ?)";
  const ingestSource = typeof source === "string" && source.trim() ? source.trim() : `integration:${String(provider)}`;
  await transaction(async (tx) => {
    for (const [signalId, value] of Object.entries(mapped.signals)) {
      await tx.run(insertHookSql, [release.id, signalId, value, ingestSource, nowIso()]);
    }
  });

  await writeAudit({
    workspaceId: release.workspace_id,
    releaseId: release.id,
    eventType: "INTEGRATION_SIGNALS_MAPPED",
    actorType: "SYSTEM",
    actorName: ingestSource,
    details: {
      provider: String(provider),
      ingest_mode: "workspace_webhook",
      mapped_signal_ids: Object.keys(mapped.signals)
    }
  });

  const out = await evaluateReleaseAfterSignalIngest(release, release.id, ingestSource, Object.keys(mapped.signals).length);
  return res.json({
    ...out,
    integration: {
      provider: String(provider),
      mapped_signal_ids: Object.keys(mapped.signals),
      ingest_mode: "workspace_webhook"
    }
  });
  } catch (e) {
    next(e);
  }
});
};
