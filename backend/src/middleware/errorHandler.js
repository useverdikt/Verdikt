"use strict";

const { IS_PROD_LIKE } = require("../config");
const { errorBody, defaultCodeForStatus } = require("../lib/apiError");

function notFoundHandler(req, res) {
  res.status(404).json(
    errorBody(req, {
      status: 404,
      code: "not_found",
      message: "Route not found"
    })
  );
}

function errorHandler(err, req, res, _next) {
  const status = Number(err?.status || err?.statusCode) || 500;
  const code =
    typeof err?.code === "string" && err.code.trim()
      ? err.code.trim()
      : status >= 500
        ? "internal_error"
        : defaultCodeForStatus(status);
  const rawMessage = err?.message || "Internal server error";
  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl || req.url}:`, rawMessage);
  }
  const body = errorBody(req, {
    status,
    code: status >= 500 && IS_PROD_LIKE ? "internal_error" : code,
    message: IS_PROD_LIKE && status >= 500 ? "Internal server error" : rawMessage,
    details: err?.details
  });
  res.status(status).json(body);
}

function registerErrorHandlers(app) {
  app.use(notFoundHandler);
  app.use(errorHandler);
}

module.exports = { registerErrorHandlers, errorHandler, notFoundHandler };
