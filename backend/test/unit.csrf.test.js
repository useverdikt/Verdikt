"use strict";

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret-32-chars-minimum!!";
process.env.NODE_ENV = "test";

const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const {
  csrfProtection,
  csrfTokensValid,
  timingSafeStrEq
} = require("../src/middleware/csrf");
const { AUTH_COOKIE_NAME, CSRF_COOKIE_NAME, JWT_SECRET } = require("../src/config");

function mockRes() {
  return {
    statusCode: 200,
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

function runCsrf(req) {
  const res = mockRes();
  let nextCalled = false;
  csrfProtection(req, res, () => {
    nextCalled = true;
  });
  return { res, nextCalled };
}

describe("csrfProtection", () => {
  const prevEnforce = process.env.CSRF_ENFORCE_IN_TEST;

  beforeEach(() => {
    process.env.CSRF_ENFORCE_IN_TEST = "1";
  });

  afterEach(() => {
    if (prevEnforce === undefined) delete process.env.CSRF_ENFORCE_IN_TEST;
    else process.env.CSRF_ENFORCE_IN_TEST = prevEnforce;
  });

  it("compares CSRF strings timing-safe", () => {
    assert.equal(timingSafeStrEq("abc", "abc"), true);
    assert.equal(timingSafeStrEq("abc", "abd"), false);
    assert.equal(timingSafeStrEq("abc", "ab"), false);
  });

  it("requires header, cookie, and JWT csrf to match", () => {
    assert.equal(csrfTokensValid("tok", "tok", "tok"), true);
    assert.equal(csrfTokensValid("tok", "tok", "other"), false);
    assert.equal(csrfTokensValid("tok", "other", "tok"), false);
    assert.equal(csrfTokensValid("", "tok", "tok"), false);
  });

  it("skips GET and Bearer-only requests", () => {
    const getReq = { method: "GET", path: "/api/releases", cookies: { [AUTH_COOKIE_NAME]: "x" }, headers: {} };
    assert.equal(runCsrf(getReq).nextCalled, true);

    const bearerReq = {
      method: "POST",
      path: "/api/releases",
      cookies: {},
      headers: { "x-csrf-token": "nope" }
    };
    assert.equal(runCsrf(bearerReq).nextCalled, true);
  });

  it("accepts a matching header, cookie, and JWT csrf claim", () => {
    const csrf = "a".repeat(64);
    const token = jwt.sign({ sub: "u1", csrf }, JWT_SECRET, { algorithm: "HS256", expiresIn: "7d" });
    const { nextCalled, res } = runCsrf({
      method: "POST",
      path: "/api/workspaces/ws_1/thresholds",
      cookies: { [AUTH_COOKIE_NAME]: token, [CSRF_COOKIE_NAME]: csrf },
      headers: { "x-csrf-token": csrf }
    });
    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 200);
  });

  it("rejects a header/cookie pair that is not bound to the session JWT", () => {
    const csrf = "b".repeat(64);
    const token = jwt.sign({ sub: "u1", csrf: "c".repeat(64) }, JWT_SECRET, {
      algorithm: "HS256",
      expiresIn: "7d"
    });
    const { nextCalled, res } = runCsrf({
      method: "POST",
      path: "/api/workspaces/ws_1/thresholds",
      cookies: { [AUTH_COOKIE_NAME]: token, [CSRF_COOKIE_NAME]: csrf },
      headers: { "x-csrf-token": csrf }
    });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.error, "invalid_csrf_token");
  });

  it("rejects legacy JWTs that have no csrf claim", () => {
    const csrf = "d".repeat(64);
    const token = jwt.sign({ sub: "u1" }, JWT_SECRET, { algorithm: "HS256", expiresIn: "7d" });
    const { nextCalled, res } = runCsrf({
      method: "POST",
      path: "/api/workspaces/ws_1/thresholds",
      cookies: { [AUTH_COOKIE_NAME]: token, [CSRF_COOKIE_NAME]: csrf },
      headers: { "x-csrf-token": csrf }
    });
    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
  });
});
