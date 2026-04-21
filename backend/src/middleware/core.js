"use strict";

const crypto = require("crypto");
const cookieParser = require("cookie-parser");
const cors = require("cors");
const express = require("express");
const helmet = require("helmet");
const { IS_PROD_LIKE } = require("../config");
const { setupRequestLogging } = require("./requestLog");
const { csrfProtection } = require("./csrf");

function setupCoreMiddleware(app) {
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"]
        }
      },
      crossOriginResourcePolicy: { policy: "cross-origin" }
    })
  );
  app.use(cookieParser());
  const CORS_ORIGINS_RAW = (process.env.CORS_ORIGINS || "").trim();
  if (IS_PROD_LIKE && !CORS_ORIGINS_RAW) {
    throw new Error(
      "CORS_ORIGINS must be set to a comma-separated allowlist when running in production-like mode (NODE_ENV=production or REQUIRE_SECURE_CONFIG=1)."
    );
  }
  if (CORS_ORIGINS_RAW) {
    const corsAllow = new Set(
      CORS_ORIGINS_RAW.split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    );
    app.use(
      cors({
        credentials: true,
        origin(origin, cb) {
          if (!origin || corsAllow.has(origin)) return cb(null, true);
          return cb(null, false);
        }
      })
    );
  } else {
    app.use(cors({ credentials: true, origin: true }));
  }
  app.use((req, res, next) => {
    req.requestId = crypto.randomUUID();
    res.setHeader("x-request-id", req.requestId);
    next();
  });
  setupRequestLogging(app);
  app.use(csrfProtection);
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        req.rawBody = buf.toString("utf8");
      }
    })
  );
}

module.exports = { setupCoreMiddleware };
