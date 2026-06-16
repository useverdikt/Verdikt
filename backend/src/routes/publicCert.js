"use strict";

const { getPublicCertRecord } = require("../services/publicCertRecord");

module.exports = function registerRoutes(app) {
  /** Public certification record — no auth; gated by workspace public_cert_records policy. */
  app.get("/api/public/cert/:workspaceSlug/:version", async (req, res, next) => {
    try {
      const out = await getPublicCertRecord(req.params.workspaceSlug, req.params.version);
      if (out.error) return res.status(out.status || 404).json({ error: "certification record not found" });
      return res.json(out.record);
    } catch (e) {
      next(e);
    }
  });
};
