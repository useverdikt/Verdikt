"use strict";

const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { JWT_SECRET, IS_PROD_LIKE, AUTH_COOKIE_NAME, CSRF_COOKIE_NAME, COOKIE_MAX_AGE_MS } = require("../config");
const { queryOne } = require("../database");
const { getUserRowForAuthById } = require("../services/authUserLookup");
const { authenticateApiKey, KEY_PREFIX } = require("../services/apiKeys");
const { userHasWorkspaceAccess, getEffectiveRoleForWorkspace } = require("../services/workspaceMembers");
const COOKIE_DOMAIN = (process.env.COOKIE_DOMAIN || "").trim();

/** Roles allowed to approve certification overrides (server-side; product UI aligns with VP Engineering). */
const OVERRIDE_APPROVER_ROLES = new Set(["vp_engineering", "cto", "org_admin"]);

function sessionPwdAt(userRow) {
  return userRow.password_changed_at || userRow.created_at || "";
}

function signToken(userRow) {
  return jwt.sign(
    {
      sub: userRow.id,
      ws: userRow.workspace_id,
      email: userRow.email,
      role: userRow.role,
      pwd_at: sessionPwdAt(userRow)
    },
    JWT_SECRET,
    { expiresIn: "7d", algorithm: "HS256" }
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
  // Cross-origin deployment (frontend on Vercel, API on Railway) requires
  // sameSite: "none" + secure: true so browsers accept Set-Cookie cross-site.
  // In local dev (IS_PROD_LIKE=false) keep "lax" so http:// works without HTTPS.
  const opts = {
    httpOnly,
    secure: IS_PROD_LIKE,
    sameSite: IS_PROD_LIKE ? "none" : "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_MS
  };
  if (COOKIE_DOMAIN) opts.domain = COOKIE_DOMAIN;
  return opts;
}

function setAuthCookies(res, token) {
  const csrf = crypto.randomBytes(32).toString("hex");
  res.cookie(AUTH_COOKIE_NAME, token, cookieOpts(true));
  // CSRF cookie must be readable by JS — sameSite "none" in prod, "strict" in dev
  res.cookie(CSRF_COOKIE_NAME, csrf, { ...cookieOpts(false), sameSite: IS_PROD_LIKE ? "none" : "strict" });
}

function clearAuthCookies(res) {
  const clearOpts = { path: "/" };
  if (COOKIE_DOMAIN) clearOpts.domain = COOKIE_DOMAIN;
  res.clearCookie(AUTH_COOKIE_NAME, clearOpts);
  res.clearCookie(CSRF_COOKIE_NAME, clearOpts);
}

function extractBearerToken(req) {
  const hdr = req.headers.authorization;
  if (hdr && hdr.startsWith("Bearer ")) return hdr.slice(7).trim();
  return null;
}

async function authMiddleware(req, res, next) {
  const bearer = extractBearerToken(req);
  if (bearer && bearer.startsWith(KEY_PREFIX)) {
    try {
      const keyRow = await authenticateApiKey(bearer);
      if (!keyRow) return res.status(401).json({ error: "Invalid or revoked API key" });
      req.auth = {
        sub: `apikey:${keyRow.id}`,
        ws: keyRow.workspace_id,
        email: `agent:${keyRow.name}`,
        role: "agent",
        authType: "api_key",
        apiKeyId: keyRow.id,
        apiKeyName: keyRow.name
      };
      return next();
    } catch (e) {
      console.error("authMiddleware api_key", e);
      return res.status(500).json({ error: "Authentication failed" });
    }
  }

  const cookieTok = req.cookies && req.cookies[AUTH_COOKIE_NAME];
  const token = bearer || cookieTok;
  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] });
    const row = await getUserRowForAuthById(payload.sub);
    if (!row) return res.status(401).json({ error: "User not found" });
    if (row.password_changed_at && payload.pwd_at !== row.password_changed_at) {
      return res.status(401).json({ error: "Session expired — sign in again" });
    }
    const effectiveRole =
      (await getEffectiveRoleForWorkspace(row.id, row.workspace_id)) || row.role;
    req.auth = {
      sub: row.id,
      ws: row.workspace_id,
      email: row.email,
      role: effectiveRole,
      authType: "session"
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

/** JWT session only — blocks agent API keys from control-plane routes. */
function requireHumanSession(req, res, next) {
  if (req.auth?.authType === "api_key") {
    return res.status(403).json({ error: "This action requires a human session, not an API key" });
  }
  next();
}

async function requireWorkspaceMatch(req, res, next) {
  try {
    if (req.auth?.authType === "api_key") {
      if (req.params.workspaceId !== req.auth.ws) {
        return res.status(403).json({ error: "Workspace access denied" });
      }
      return next();
    }
    const allowed = await userHasWorkspaceAccess(req.auth.sub, req.params.workspaceId);
    if (!allowed) {
      return res.status(403).json({ error: "Workspace access denied" });
    }
    const role = await getEffectiveRoleForWorkspace(req.auth.sub, req.params.workspaceId);
    if (role) req.auth.role = role;
    next();
  } catch (e) {
    next(e);
  }
}

async function requireReleaseAccess(req, res, next) {
  try {
    const release = await queryOne("SELECT * FROM releases WHERE id = ?", [req.params.releaseId]);
    if (!release) return res.status(404).json({ error: "release not found" });
    if (req.auth?.authType === "api_key") {
      if (req.auth.ws !== release.workspace_id) {
        return res.status(403).json({ error: "Release access denied" });
      }
      req.releaseRow = release;
      return next();
    }
    const allowed = await userHasWorkspaceAccess(req.auth.sub, release.workspace_id);
    if (!allowed) {
      return res.status(403).json({ error: "Release access denied" });
    }
    const role = await getEffectiveRoleForWorkspace(req.auth.sub, release.workspace_id);
    if (role) req.auth.role = role;
    req.releaseRow = release;
    next();
  } catch (e) {
    next(e);
  }
}

/** Workspace roles that cannot mutate state (mirrors frontend ROLES.canAct). */
const READ_ONLY_ROLES = new Set(["viewer", "engineer"]);

/** Blocks read-only workspace roles from mutating routes (role is DB-authoritative from authMiddleware). */
function requireNonViewer(req, res, next) {
  if (READ_ONLY_ROLES.has(req.auth.role)) {
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
  requireHumanSession,
  requireWorkspaceMatch,
  requireReleaseAccess,
  requireNonViewer,
  requireOverrideApproverRole,
  READ_ONLY_ROLES,
  OVERRIDE_APPROVER_ROLES
};
