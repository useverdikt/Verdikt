"use strict";

const crypto = require("crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const { queryOne, run, transaction } = require("../database");
const config = require("../config");
const { findApplicationUserForSupabaseSub, getUserRowForAuthById } = require("../services/authUserLookup");
const { nowIso, toIsoPlusMinutes } = require("../lib/time");
const { writeAudit } = require("../services/audit");
const {
  authMiddleware,
  signToken,
  publicUser,
  setAuthCookies,
  clearAuthCookies
} = require("../middleware/auth");
const {
  checkLoginRateLimit,
  checkForgotPasswordRateLimit,
  checkRegisterRateLimit,
  checkWaitlistRateLimit
} = require("../middleware/rateLimit");
const { sendPasswordResetEmail, sendAlreadyRegisteredEmail, sendWaitlistLeadEmail } = require("../services/email");
const { ensureWorkspaceSeeded } = require("../services/domain");

const { BCRYPT_ROUNDS, IS_PROD_LIKE, ALLOW_PUBLIC_REGISTRATION, SUPABASE_JWT_SECRET } = config;

const FORGOT_PASSWORD_GENERIC =
  "If an account exists for that address, we've sent reset instructions.";

const REGISTER_RESPONSE_MESSAGE =
  "If this email can receive a new account, sign in with your password to continue. If you are already registered, use Sign in — we may have sent a notice to this inbox.";

module.exports = function registerAuthRoutes(app) {
  app.post("/api/auth/register", async (req, res) => {
    if (!ALLOW_PUBLIC_REGISTRATION) {
      return res.status(403).json({
        error:
          "Self-service registration is not available. Join the waitlist on the site, or sign in if you already have an account."
      });
    }
    const { email: rawEmail, password, name: rawName } = req.body || {};
    const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
    const name = typeof rawName === "string" ? rawName.trim() : "";
    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "Valid email is required" });
    }
    if (typeof password !== "string" || password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }
    const existing = await queryOne("SELECT id FROM users WHERE email = ?", [email]);
    if (existing) {
      try {
        const r = await sendAlreadyRegisteredEmail({ to: email });
        if (!r.skipped && r.ok === false) {
          console.warn(`[${req.requestId}] already-registered email notify failed`, r.error);
        }
      } catch (e) {
        console.warn(`[${req.requestId}] already-registered email notify`, e);
      }
      return res.status(200).json({ ok: true, message: REGISTER_RESPONSE_MESSAGE });
    }
    if (!(await checkRegisterRateLimit(req.ip))) {
      return res.status(429).json({ error: "Too many registration attempts. Please try again later." });
    }
    const id = crypto.randomUUID();
    const workspace_id = `ws_${id.replace(/-/g, "").slice(0, 16)}`;
    const password_hash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
    const displayName =
      name || email.split("@")[0].replace(/[._-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    await run(
      "INSERT INTO users (id, email, password_hash, name, workspace_id, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, email, password_hash, displayName, workspace_id, "ai_product_lead", nowIso()]
    );
    await ensureWorkspaceSeeded(workspace_id);
    return res.status(200).json({ ok: true, message: REGISTER_RESPONSE_MESSAGE });
  });

  app.post("/api/auth/login", async (req, res) => {
    const { email: rawEmail, password } = req.body || {};
    const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
    if (!email || typeof password !== "string") {
      return res.status(400).json({ error: "Email and password are required" });
    }
    if (!(await checkLoginRateLimit(req.ip, email))) {
      await writeAudit({
        workspaceId: "__auth__",
        eventType: "AUTH_LOGIN_RATE_LIMITED",
        actorType: "SYSTEM",
        actorName: "auth_guard",
        details: { email, ip: req.ip, request_id: req.requestId }
      });
      return res.status(429).json({ error: "Too many login attempts. Please try again shortly." });
    }
    const userRow = await queryOne("SELECT * FROM users WHERE email = ?", [email]);
    const isValid = userRow ? await bcrypt.compare(password, userRow.password_hash) : false;
    if (!isValid) {
      await writeAudit({
        workspaceId: userRow?.workspace_id || "__auth__",
        eventType: "AUTH_LOGIN_FAILED",
        actorType: "SYSTEM",
        actorName: "auth",
        details: { email, ip: req.ip, request_id: req.requestId }
      });
      return res.status(401).json({ error: "Invalid email or password" });
    }
    await writeAudit({
      workspaceId: userRow.workspace_id,
      eventType: "AUTH_LOGIN_SUCCEEDED",
      actorType: "USER",
      actorName: email,
      details: { ip: req.ip, request_id: req.requestId }
    });
    const token = signToken(userRow);
    setAuthCookies(res, token);
    return res.json({ user: publicUser(userRow) });
  });

  app.post("/api/auth/logout", (req, res) => {
    clearAuthCookies(res);
    return res.status(204).end();
  });

  app.post("/api/auth/session-from-supabase", async (req, res) => {
    if (!SUPABASE_JWT_SECRET) {
      return res.status(503).json({
        error:
          "Supabase session exchange is not configured. Set SUPABASE_JWT_SECRET (Dashboard → Settings → API → JWT Secret)."
      });
    }
    const { access_token: accessToken } = req.body || {};
    if (typeof accessToken !== "string" || !accessToken.trim()) {
      return res.status(400).json({ error: "access_token is required" });
    }
    let sub;
    try {
      const p = jwt.verify(accessToken.trim(), SUPABASE_JWT_SECRET, { algorithms: ["HS256"] });
      sub = p.sub;
    } catch {
      return res.status(401).json({ error: "Invalid Supabase access token" });
    }
    try {
      const userRow = await findApplicationUserForSupabaseSub(sub);
      if (!userRow) {
        return res.status(401).json({
          error:
            "No application user for this Supabase account. Use Supabase Postgres (DATABASE_URL) with migrations applied, or add auth_user_id in local SQLite."
        });
      }
      const token = signToken(userRow);
      setAuthCookies(res, token);
      return res.json({ user: publicUser(userRow) });
    } catch (e) {
      console.error(`[${req.requestId}] session-from-supabase`, e);
      return res.status(500).json({ error: "Session exchange failed" });
    }
  });

  app.post("/api/auth/forgot-password", async (req, res) => {
    const { email: rawEmail } = req.body || {};
    const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
    if (!email || !email.includes("@")) {
      return res.status(400).json({ error: "Valid email is required" });
    }
    if (!(await checkForgotPasswordRateLimit(req.ip))) {
      return res.status(429).json({ error: "Too many requests. Please try again shortly." });
    }
    const userRow = await queryOne("SELECT * FROM users WHERE email = ?", [email]);
    const payload = { ok: true, message: FORGOT_PASSWORD_GENERIC };
    const leakToken =
      process.env.NODE_ENV === "test" ||
      (process.env.NODE_ENV === "development" && process.env.PASSWORD_RESET_RETURN_TOKEN === "1");
    try {
      if (userRow) {
        const now = nowIso();
        await run("UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL", [
          now,
          userRow.id
        ]);
        const rawToken = crypto.randomBytes(32).toString("base64url");
        const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
        const tokenId = `prt_${crypto.randomBytes(8).toString("hex")}`;
        const expiresAt = toIsoPlusMinutes(60);
        await run(
          `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, used_at, created_at)
         VALUES (?, ?, ?, ?, NULL, ?)`,
          [tokenId, userRow.id, tokenHash, expiresAt, now]
        );
        await writeAudit({
          workspaceId: userRow.workspace_id,
          eventType: "AUTH_PASSWORD_RESET_REQUESTED",
          actorType: "USER",
          actorName: email,
          details: { ip: req.ip, request_id: req.requestId }
        });
        if (leakToken) {
          payload.reset_token = rawToken;
          payload.reset_expires_at = expiresAt;
        } else {
          const sendResult = await sendPasswordResetEmail({ to: email, resetToken: rawToken });
          if (sendResult.skipped) {
            if (IS_PROD_LIKE) {
              console.error(
                `[${req.requestId}] password reset: email not configured — set RESEND_API_KEY and PUBLIC_APP_URL`
              );
            } else {
              console.warn(
                `[${req.requestId}] password reset: no email sent (configure RESEND_API_KEY + PUBLIC_APP_URL, or PASSWORD_RESET_RETURN_TOKEN=1 for local dev)`
              );
            }
          } else if (sendResult.ok === false) {
            console.error(`[${req.requestId}] password reset email failed`, sendResult.error);
          }
        }
      }
      return res.status(200).json(payload);
    } catch (e) {
      console.error(`[${req.requestId}] forgot-password`, e);
      return res.status(500).json({ error: "Something went wrong" });
    }
  });

  const WAITLIST_Q_ROLE = new Set([
    "engineering_leadership",
    "quality_qe",
    "platform_sre",
    "ic_solo_other"
  ]);
  const WAITLIST_Q_TEAM = new Set(["just_me", "2_5", "6_20", "21_plus"]);
  const WAITLIST_Q_PROCESS = new Set(["informal", "ticket_some", "formal_audit"]);
  const WAITLIST_Q_PAIN = new Set(["reputation", "revenue", "compliance", "eng_time", "other"]);

  app.post("/api/waitlist-requests", async (req, res) => {
    const body = req.body || {};
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 200) : "";
    const rawEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const company = typeof body.company === "string" ? body.company.trim().slice(0, 200) : "";
    const message = typeof body.message === "string" ? body.message.trim().slice(0, 8000) : "";
    const qRole = typeof body.q_role === "string" ? body.q_role.trim() : "";
    const qTeamSize = typeof body.q_team_size === "string" ? body.q_team_size.trim() : "";
    const qReleaseProcess = typeof body.q_release_process === "string" ? body.q_release_process.trim() : "";
    const qGoal = typeof body.q_goal === "string" ? body.q_goal.trim().slice(0, 2000) : "";
    const rawPain = body.q_pain_points;
    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail);
    if (!name || !rawEmail || !company) {
      return res.status(400).json({ error: "Name, work email, and company are required" });
    }
    if (!emailOk) {
      return res.status(400).json({ error: "Valid work email is required" });
    }
    if (!qRole || !WAITLIST_Q_ROLE.has(qRole)) {
      return res.status(400).json({ error: "Please answer: what best describes your role?" });
    }
    if (!qTeamSize || !WAITLIST_Q_TEAM.has(qTeamSize)) {
      return res.status(400).json({ error: "Please answer: team size on a typical release" });
    }
    if (!qReleaseProcess || !WAITLIST_Q_PROCESS.has(qReleaseProcess)) {
      return res.status(400).json({ error: "Please answer: how known issues are handled today" });
    }
    let painPoints = [];
    if (Array.isArray(rawPain)) {
      painPoints = rawPain.filter((x) => typeof x === "string").map((x) => x.trim());
    }
    const painDedup = [...new Set(painPoints)].filter((p) => WAITLIST_Q_PAIN.has(p));
    if (painDedup.length < 1 || painDedup.length > 2) {
      return res.status(400).json({ error: "Please select 1–2 options for what would hurt most" });
    }
    const qPainJson = JSON.stringify(painDedup);
    if (!(await checkWaitlistRateLimit(req.ip))) {
      return res.status(429).json({ error: "Too many submissions. Please try again later." });
    }
    const ip = (req.ip || "").toString().slice(0, 64);
    const created = nowIso();
    try {
      const ins = await run(
        `INSERT INTO waitlist_requests (
           name, email, company, role, message, created_at, source_ip,
           q_role, q_team_size, q_release_process, q_pain_points, q_goal
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
        [
          name,
          rawEmail,
          company,
          null,
          message || null,
          created,
          ip || null,
          qRole,
          qTeamSize,
          qReleaseProcess,
          qPainJson,
          qGoal || null
        ]
      );
      const notifyTo = (process.env.WAITLIST_NOTIFY_EMAIL || "").trim();
      if (notifyTo) {
        const sendResult = await sendWaitlistLeadEmail({
          notifyTo,
          name,
          email: rawEmail,
          company,
          message,
          qualification: {
            q_role: qRole,
            q_team_size: qTeamSize,
            q_release_process: qReleaseProcess,
            q_pain_points: painDedup,
            q_goal: qGoal || ""
          }
        });
        if (sendResult.skipped) {
          console.warn(
            `[${req.requestId}] waitlist: row saved but notify email skipped (configure RESEND_API_KEY + WAITLIST_NOTIFY_EMAIL)`
          );
        } else if (sendResult.ok === false) {
          console.error(`[${req.requestId}] waitlist notify email failed`, sendResult.error);
        }
      }
      return res.status(201).json({ ok: true, id: ins.lastInsertRowid });
    } catch (e) {
      console.error(`[${req.requestId}] waitlist-requests`, e);
      return res.status(500).json({ error: "Something went wrong" });
    }
  });

  app.post("/api/auth/reset-password", async (req, res) => {
    const { token: rawToken, password } = req.body || {};
    if (typeof rawToken !== "string" || !rawToken.trim()) {
      return res.status(400).json({ error: "Reset token is required" });
    }
    if (typeof password !== "string" || password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }
    const tokenHash = crypto.createHash("sha256").update(rawToken.trim()).digest("hex");
    const row = await queryOne(
      `SELECT pr.*, u.email, u.workspace_id FROM password_reset_tokens pr
       JOIN users u ON u.id = pr.user_id
       WHERE pr.token_hash = ? AND pr.used_at IS NULL`,
      [tokenHash]
    );
    if (!row) {
      return res.status(400).json({ error: "Invalid or expired reset link" });
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      return res.status(400).json({ error: "Invalid or expired reset link" });
    }
    const password_hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    await transaction(async (tx) => {
      await tx.run("UPDATE users SET password_hash = ? WHERE id = ?", [password_hash, row.user_id]);
      await tx.run("UPDATE password_reset_tokens SET used_at = ? WHERE id = ?", [nowIso(), row.id]);
    });
    await writeAudit({
      workspaceId: row.workspace_id,
      eventType: "AUTH_PASSWORD_RESET_COMPLETED",
      actorType: "USER",
      actorName: row.email,
      details: { ip: req.ip, request_id: req.requestId }
    });
    return res.json({ ok: true, message: "Password updated. You can sign in with your new password." });
  });

  app.get("/api/auth/me", authMiddleware, async (req, res) => {
    const userRow = await getUserRowForAuthById(req.auth.sub);
    if (!userRow) return res.status(401).json({ error: "User not found" });
    return res.json({ user: publicUser(userRow) });
  });
};
