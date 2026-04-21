"use strict";

const { AUTH_COOKIE_NAME, CSRF_COOKIE_NAME } = require("../config");

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

/**
 * Double-submit CSRF: when the HttpOnly auth cookie is present, require X-CSRF-Token
 * to match the readable CSRF cookie. Skipped when only Bearer auth is used (no session cookie).
 */
function csrfProtection(req, res, next) {
  if (process.env.NODE_ENV === "test") return next();
  if (!isUnsafeMethod(req.method)) return next();
  const p = req.path || "";
  for (const prefix of CSRF_EXEMPT_PREFIXES) {
    if (p === prefix || p.startsWith(prefix)) return next();
  }
  if (!req.cookies || !req.cookies[AUTH_COOKIE_NAME]) return next();
  const header = (req.headers["x-csrf-token"] || "").toString();
  const cookie = (req.cookies[CSRF_COOKIE_NAME] || "").toString();
  if (header && cookie && header === cookie) return next();
  return res.status(403).json({ error: "Invalid CSRF token" });
}

module.exports = { csrfProtection };
