"use strict";

const { sendError } = require("./apiError");

function formatSchemaIssues(error) {
  return (error?.issues || []).map((issue) => ({
    path: issue.path.map(String).join("."),
    code: issue.code,
    message: issue.message
  }));
}

function parseRequestBody(schema, req, res, { message = "invalid request body" } = {}) {
  const result = schema.safeParse(req.body ?? {});
  if (result.success) return { ok: true, data: result.data };

  sendError(res, req, 400, message, {
    details: {
      issues: formatSchemaIssues(result.error)
    }
  });
  return { ok: false, data: null };
}

module.exports = {
  formatSchemaIssues,
  parseRequestBody
};
