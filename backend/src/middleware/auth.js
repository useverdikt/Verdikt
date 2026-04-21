"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { JWT_SECRET, IS_PROD_LIKE, AUTH_COOKIE_NAME, CSRF_COOKIE_NAME, COOKIE_MAX_AGE_MS } = require("../config");
const { queryOne } = require("../database");
const { getUserRowForAuthById } = require("../services/authUserLookup");

/** Roles allowed to approve certification overrides (server-side; product UI aligns with VP Engineering). */
const OVERRIDE_APPROVER_ROLES = new Set(["vp_engineering", "cto", "org_admin"]);

function signToken(userRow) {
  return jwt.sign(
    { sub: userRow.id, ws: userRow.workspace_id, email: userRow.email, role: userRow.role },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    workspace_id: row.workspace_id,
    role: row.role
  };
}

function cookieOpts(httpOnly) {
  return {
    httpOnly,
    secure: IS_PROD_LIKE,
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_MS
  };
}

function setAuthCookies(res, token) {
  const csrf = crypto.randomBytes(32).toString("hex");
  res.cookie(AUTH_COOKIE_NAME, token, cookieOpts(true));
  res.cookie(CSRF_COOKIE_NAME, csrf, { ...cookieOpts(false), sameSite: "strict" });
}

function clearAuthCookies(res) {
  res.clearCookie(AUTH_COOKIE_NAME, { path: "/" });
  res.clearCookie(CSRF_COOKIE_NAME, { path: "/" });
}

function extractBearerToken(req) {
  const hdr = req.headers.authorization;
  if (hdr && hdr.startsWith("Bearer ")) return hdr.slice(7).trim();
  return null;
}

async function authMiddleware(req, res, next) {
  const bearer = extractBearerToken(req);
  const cookieTok = req.cookies && req.cookies[AUTH_COOKIE_NAME];
  const token = bearer || cookieTok;
  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const row = await getUserRowForAuthById(payload.sub);
    if (!row) return res.status(401).json({ error: "User not found" });
    req.auth = {
      sub: row.id,
      ws: row.workspace_id,
      email: row.email,
      role: row.role
    };
    next();
  } catch (e) {
    if (e && (e.name === "JsonWebTokenError" || e.name === "TokenExpiredError")) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
    console.error("authMiddleware", e);
    return res.status(500).json({ error: "Authentication failed" });
  }
}

function requireWorkspaceMatch(req, res, next) {
  if (req.params.workspaceId !== req.auth.ws) {
    return res.status(403).json({ error: "Workspace access denied" });
  }
  next();
}

async function requireReleaseAccess(req, res, next) {
  try {
    const release = await queryOne("SELECT * FROM releases WHERE id = ?", [req.params.releaseId]);
    if (!release) return res.status(404).json({ error: "release not found" });
    if (req.auth.ws !== release.workspace_id) {
      return res.status(403).json({ error: "Release access denied" });
    }
    req.releaseRow = release;
    next();
  } catch (e) {
    next(e);
  }
}

/** Blocks read-only workspace role from mutating routes (role is DB-authoritative from authMiddleware). */
function requireNonViewer(req, res, next) {
  if (req.auth.role === "viewer") {
    return res.status(403).json({ error: "Insufficient permissions (read-only role)" });
  }
  next();
}

function requireOverrideApproverRole(req, res, next) {
  if (!OVERRIDE_APPROVER_ROLES.has(req.auth.role)) {
    return res.status(403).json({ error: "Override approval requires VP Engineering, CTO, or org admin role" });
  }
  next();
}

module.exports = {
  signToken,
  publicUser,
  setAuthCookies,
  clearAuthCookies,
  authMiddleware,
  requireWorkspaceMatch,
  requireReleaseAccess,
  requireNonViewer,
  requireOverrideApproverRole,
  OVERRIDE_APPROVER_ROLES
};
