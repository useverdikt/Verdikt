"use strict";

const express = require("express");

const { setupCoreMiddleware } = require("./middleware/core");
const registerRoutes = require("./routes");

function createApp() {
  const app = express();
  if (process.env.TRUST_PROXY === "1") {
    app.set("trust proxy", 1);
  }
  setupCoreMiddleware(app);
  registerRoutes(app);
  return app;
}

module.exports = { createApp };
