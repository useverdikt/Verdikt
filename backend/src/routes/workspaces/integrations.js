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
};
