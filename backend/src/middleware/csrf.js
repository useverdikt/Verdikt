"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { AUTH_COOKIE_NAME, CSRF_COOKIE_NAME, JWT_SECRET } = require("../config");
const { sendError } = require("../lib/apiError");

const CSRF_EXEMPT_PREFIXES = [
  "/api/auth/login",
  "/api/auth/register",
  "/api/auth/session-from-supabase",
  "/api/auth/forgot-password",
  "/api/auth/reset-password",
  "/api/waitlist-requests",
  "/api/hooks/"
];

function isUnsafeMethod(method) {
  const m = method.toUpperCase();
  return m !== "GET" && m !== "HEAD" && m !== "OPTIONS";
}

function csrfEnforced() {
  if (process.env.NODE_ENV !== "test") return true;
  return process.env.CSRF_ENFORCE_IN_TEST === "1";
}

function timingSafeStrEq(a, b) {
  const ba = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function sessionCsrfFromAuthCookie(cookieTok) {
  try {
    const payload = jwt.verify(cookieTok, JWT_SECRET, { algorithms: ["HS256"] });
    return typeof payload.csrf === "string" && payload.csrf ? payload.csrf : "";
  } catch {
    return "";
  }
}

function csrfTokensValid(header, cookie, jwtCsrf) {
  if (!header || !cookie || !jwtCsrf) return false;
  return timingSafeStrEq(header, cookie) && timingSafeStrEq(cookie, jwtCsrf);
}

/**
 * Double-submit CSRF bound to the session JWT:
 * X-CSRF-Token, readable CSRF cookie, and JWT `csrf` claim must all match.
 * Skipped when only Bearer auth is used (no session cookie).
 */
function csrfProtection(req, res, next) {
  if (!csrfEnforced()) return next();
  if (!isUnsafeMethod(req.method)) return next();
  const p = req.path || "";
  for (const prefix of CSRF_EXEMPT_PREFIXES) {
    if (p === prefix || p.startsWith(prefix)) return next();
  }
  if (!req.cookies || !req.cookies[AUTH_COOKIE_NAME]) return next();
  const header = (req.headers["x-csrf-token"] || "").toString();
  const cookie = (req.cookies[CSRF_COOKIE_NAME] || "").toString();
  const jwtCsrf = sessionCsrfFromAuthCookie(req.cookies[AUTH_COOKIE_NAME]);
  if (csrfTokensValid(header, cookie, jwtCsrf)) return next();
  return sendError(res, req, 403, "invalid_csrf_token", { message: "Invalid CSRF token" });
}

module.exports = {
  csrfProtection,
  csrfTokensValid,
  timingSafeStrEq,
  sessionCsrfFromAuthCookie,
  CSRF_EXEMPT_PREFIXES
};
