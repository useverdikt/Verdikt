"use strict";

const { IS_PROD_LIKE } = require("../config");

function notFoundHandler(_req, res) {
  res.status(404).json({ error: "not_found", message: "Route not found" });
}

function errorHandler(err, req, res, _next) {
  const status = Number(err?.status || err?.statusCode) || 500;
  const message = err?.message || "Internal server error";
  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl || req.url}:`, message);
  }
  res.status(status).json({
    error: status >= 500 ? "internal_error" : "request_failed",
    message: IS_PROD_LIKE && status >= 500 ? "Internal server error" : message,
    request_id: req.requestId || null
  });
}

function registerErrorHandlers(app) {
  app.use(notFoundHandler);
  app.use(errorHandler);
}

module.exports = { registerErrorHandlers, errorHandler, notFoundHandler };
