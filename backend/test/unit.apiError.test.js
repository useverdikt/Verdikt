"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { sendError, errorBody, ApiError, isMachineCode } = require("../src/lib/apiError");

function mockRes() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

describe("apiError contract", () => {
  it("isMachineCode accepts snake_case and dotted codes", () => {
    assert.equal(isMachineCode("human_session_required"), true);
    assert.equal(isMachineCode("auth.invalid_token"), true);
    assert.equal(isMachineCode("signals object is required"), false);
  });

  it("sendError turns human text into message + status default code", () => {
    const res = mockRes();
    const req = { requestId: "rid-1" };
    sendError(res, req, 400, "signals object is required");
    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.body, {
      error: "bad_request",
      message: "signals object is required",
      request_id: "rid-1"
    });
  });

  it("sendError accepts explicit machine code + message + details", () => {
    const res = mockRes();
    sendError(res, { requestId: "rid-2" }, 403, "human_session_required", {
      message: "This action requires a human session, not an API key",
      details: { authType: "api_key" }
    });
    assert.deepEqual(res.body, {
      error: "human_session_required",
      message: "This action requires a human session, not an API key",
      request_id: "rid-2",
      details: { authType: "api_key" }
    });
  });

  it("errorBody and ApiError share the same shape fields", () => {
    const body = errorBody({ requestId: "x" }, { status: 404, code: "not_found", message: "gone" });
    assert.equal(body.error, "not_found");
    assert.equal(body.message, "gone");
    assert.equal(body.request_id, "x");

    const err = new ApiError(409, "not_pending", { message: "already resolved", details: { state: "done" } });
    assert.equal(err.status, 409);
    assert.equal(err.code, "not_pending");
    assert.equal(err.message, "already resolved");
    assert.deepEqual(err.details, { state: "done" });
  });
});
