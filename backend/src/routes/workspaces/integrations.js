"use strict";

const {
  writeAudit,
  authMiddleware,
  requireNonViewer,
  requireWorkspaceMatch,
  validateSignalPayload,
  getSignalSchema,
  upsertIntegration,
  listIntegrations,
  deleteIntegration,
  importCsv,
  getLatestCsvImport,
  deleteCsvImports,
  applyCsvImportToWorkspace,
  signalCsvUpload
} = require("../deps");

module.exports = function registerRoutes(app) {
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
const { buildSignalSourcesPanel } = require("../../services/signalSourcesPanel");
const { createIntegrationRequest } = require("../../services/integrationRequests");

app.get("/api/workspaces/:workspaceId/signal-integrations", authMiddleware, requireWorkspaceMatch, async (req, res, next) => {
  try {
    const workspaceId = req.params.workspaceId;
    const [integrations, csv_import, panel] = await Promise.all([
      listIntegrations(workspaceId),
      getLatestCsvImport(workspaceId),
      buildSignalSourcesPanel(workspaceId)
    ]);
    return res.json({
      workspace_id: workspaceId,
      integrations,
      csv_import,
      pull_connectors: panel.pull_connectors,
      push_sources: panel.push_sources,
      integration_requests: panel.integration_requests,
      api_push: panel.api_push
    });
  } catch (e) {
    next(e);
  }
});

app.post("/api/workspaces/:workspaceId/integration-requests", authMiddleware, requireNonViewer, requireWorkspaceMatch, async (req, res) => {
  try {
    const out = await createIntegrationRequest(req.params.workspaceId, req.body || {}, req.auth?.email);
    await writeAudit({
      workspaceId: req.params.workspaceId,
      eventType: "INTEGRATION_REQUESTED",
      actorType: "USER",
      actorName: req.auth?.email || "user",
      details: { request_id: out.id, source_name: out.source_name }
    });
    return res.status(201).json(out);
  } catch (err) {
    return res.status(400).json({ error: err.message || String(err) });
  }
});

app.put("/api/workspaces/:workspaceId/signal-integrations/:sourceId", authMiddleware, requireNonViewer, requireWorkspaceMatch, async (req, res) => {
  try {
    const out = await upsertIntegration(req.params.workspaceId, req.params.sourceId, req.body || {});
    await writeAudit({
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
    await writeAudit({
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
      await writeAudit({
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
  await writeAudit({
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

const {
  getIntegrationReadiness,
  probeIntegrationReadiness
} = require("../../services/integrationReadiness");

/** Partner onboarding: which integrations are connected and how to tag commit SHA. */
app.get(
  "/api/workspaces/:workspaceId/integration-readiness",
  authMiddleware,
  requireWorkspaceMatch,
  async (req, res, next) => {
    try {
      return res.json(await getIntegrationReadiness(req.params.workspaceId));
    } catch (e) {
      next(e);
    }
  }
);

/** Dry-run: can Verdikt find vendor data for this commit SHA? (no cert window required) */
app.post(
  "/api/workspaces/:workspaceId/integration-readiness/probe",
  authMiddleware,
  requireNonViewer,
  requireWorkspaceMatch,
  async (req, res, next) => {
    try {
      const { commit_sha, version } = req.body || {};
      const out = await probeIntegrationReadiness(req.params.workspaceId, commit_sha, { version });
      if (out.error) return res.status(400).json({ error: out.error });
      return res.json(out);
    } catch (e) {
      next(e);
    }
  }
);
};
