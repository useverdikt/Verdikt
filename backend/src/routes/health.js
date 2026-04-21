"use strict";

const { queryOne } = require("../database");
const config = require("../config");
const { authMiddleware } = require("../middleware/auth");

const { AI_SIGNAL_DEFINITIONS, ALLOW_PUBLIC_REGISTRATION } = config;

module.exports = function registerHealthRoutes(app) {
  app.get("/health", (_req, res) => {
    res.json({ ok: true, service: "verdikt-backend" });
  });

  /** Public: whether the SPA may self-register (onboarding account creation). */
  app.get("/api/public/registration", (_req, res) => {
    res.json({ allow_public_registration: ALLOW_PUBLIC_REGISTRATION });
  });

  /** Readiness: PostgreSQL reachable (DATABASE_URL). */
  app.get("/health/ready", async (_req, res) => {
    try {
      await queryOne("SELECT 1 AS ok");
      return res.json({
        ok: true,
        service: "verdikt-backend",
        checks: { database: true }
      });
    } catch {
      return res.status(503).json({
        ok: false,
        service: "verdikt-backend",
        checks: { database: false }
      });
    }
  });

  app.get("/api/signal-definitions", authMiddleware, (_req, res) => {
    return res.json({ ai_signals: AI_SIGNAL_DEFINITIONS });
  });
};
