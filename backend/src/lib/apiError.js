"use strict";

/**
 * Standard API error body:
 *   { error: <machine_code>, message: <human>, request_id, details? }
 *
 * Prefer sendError() from routes/middleware instead of ad-hoc res.status().json({ error }).
 */

const DEFAULT_CODE_BY_STATUS = {
  400: "bad_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  422: "unprocessable_entity",
  429: "rate_limited",
  500: "internal_error",
  502: "bad_gateway",
  503: "service_unavailable"
};

function defaultCodeForStatus(status) {
  return DEFAULT_CODE_BY_STATUS[Number(status)] || "request_failed";
}

/** snake_case machine codes (optionally dotted namespaces like auth.invalid_token). */
function isMachineCode(value) {
  return typeof value === "string" && /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/.test(value);
}

function humanizeCode(code) {
  if (!code || typeof code !== "string") return "Request failed";
  return code.replace(/[._]/g, " ");
}

/**
 * Build the canonical error JSON body (no response write).
 * @param {import('express').Request|null|undefined} req
 * @param {{ code?: string, message?: string, details?: unknown, status?: number }} opts
 */
function errorBody(req, opts = {}) {
  const status = Number(opts.status) || 400;
  const code = opts.code && isMachineCode(opts.code) ? opts.code : defaultCodeForStatus(status);
  const message =
    typeof opts.message === "string" && opts.message.trim()
      ? opts.message.trim()
      : humanizeCode(code);
  const body = {
    error: code,
    message,
    request_id: req?.requestId || null
  };
  if (opts.details !== undefined) body.details = opts.details;
  return body;
}

/**
 * Send a standardized error response.
 *
 * Forms:
 *   sendError(res, req, 400, "signals object is required")
 *   sendError(res, req, 403, "human_session_required", { message: "..." })
 *   sendError(res, req, 404, { code: "suggestion_not_found", message: "..." })
 *   sendError(res, req, 409, "not_pending", { details: { state }, message: "..." })
 *
 * @returns {import('express').Response}
 */
function sendError(res, req, status, codeOrMessageOrOpts, maybeOpts) {
  const statusCode = Number(status) || 500;
  let code;
  let message;
  let details;

  if (codeOrMessageOrOpts && typeof codeOrMessageOrOpts === "object" && !Array.isArray(codeOrMessageOrOpts)) {
    code = codeOrMessageOrOpts.code;
    message = codeOrMessageOrOpts.message;
    details = codeOrMessageOrOpts.details;
  } else if (typeof codeOrMessageOrOpts === "string") {
    const opts = maybeOpts && typeof maybeOpts === "object" ? maybeOpts : {};
    details = opts.details;
    if (isMachineCode(codeOrMessageOrOpts)) {
      code = codeOrMessageOrOpts;
      message = opts.message;
    } else {
      code = opts.code || defaultCodeForStatus(statusCode);
      message = codeOrMessageOrOpts;
    }
    if (opts.message && !isMachineCode(codeOrMessageOrOpts)) {
      message = opts.message;
    }
  } else {
    code = defaultCodeForStatus(statusCode);
    message = "Request failed";
  }

  return res.status(statusCode).json(
    errorBody(req, {
      status: statusCode,
      code,
      message,
      details
    })
  );
}

/**
 * Error for `next(err)` that the central errorHandler serializes with the same contract.
 */
class ApiError extends Error {
  /**
   * @param {number} status
   * @param {string} codeOrMessage
   * @param {{ code?: string, message?: string, details?: unknown }} [opts]
   */
  constructor(status, codeOrMessage, opts = {}) {
    const statusCode = Number(status) || 500;
    let code;
    let message;
    if (typeof codeOrMessage === "string" && isMachineCode(codeOrMessage) && (opts.message || !opts.code)) {
      code = codeOrMessage;
      message = opts.message || humanizeCode(codeOrMessage);
    } else if (typeof codeOrMessage === "string") {
      code = opts.code || defaultCodeForStatus(statusCode);
      message = codeOrMessage;
    } else {
      code = opts.code || defaultCodeForStatus(statusCode);
      message = opts.message || humanizeCode(code);
    }
    super(message);
    this.name = "ApiError";
    this.status = statusCode;
    this.statusCode = statusCode;
    this.code = code;
    if (opts.details !== undefined) this.details = opts.details;
  }
}

module.exports = {
  ApiError,
  DEFAULT_CODE_BY_STATUS,
  defaultCodeForStatus,
  errorBody,
  humanizeCode,
  isMachineCode,
  sendError
};
