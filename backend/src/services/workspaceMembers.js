"use strict";

const crypto = require("crypto");
const { queryOne, queryAll, run } = require("../database");
const { nowIso, toIsoPlusMinutes } = require("../lib/time");
const { writeAudit } = require("./audit");
const { sendWorkspaceInviteEmail } = require("./email");

const VALID_ROLES = new Set([
  "ai_product_lead",
  "ml_engineer",
  "qe_lead",
  "tech_lead",
  "release_manager",
  "vp_engineering",
  "cto",
  "org_admin",
  "engineer",
  "viewer"
]);

const INVITE_TTL_HOURS = 168;

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function isValidRole(role) {
  return VALID_ROLES.has(String(role || "").trim());
}

async function userHasWorkspaceAccess(userId, workspaceId) {
  const member = await queryOne(
    "SELECT 1 AS ok FROM workspace_members WHERE user_id = ? AND workspace_id = ?",
    [userId, workspaceId]
  );
  if (member) return true;
  const user = await queryOne("SELECT workspace_id FROM users WHERE id = ?", [userId]);
  return user?.workspace_id === workspaceId;
}

async function getEffectiveRoleForWorkspace(userId, workspaceId) {
  const member = await queryOne(
    "SELECT role FROM workspace_members WHERE user_id = ? AND workspace_id = ?",
    [userId, workspaceId]
  );
  if (member?.role) return member.role;
  const user = await queryOne("SELECT role, workspace_id FROM users WHERE id = ?", [userId]);
  if (user?.workspace_id === workspaceId) return user.role;
  return null;
}

async function ensureMemberRow({ workspaceId, userId, role, createdAt = null }) {
  const ts = createdAt || nowIso();
  await run(
    `INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = excluded.role`,
    [workspaceId, userId, role, ts]
  );
}

async function listWorkspaceMembersAndInvites(workspaceId) {
  const members = await queryAll(
    `SELECT u.id AS user_id, u.name, u.email, wm.role, wm.created_at
     FROM workspace_members wm
     JOIN users u ON u.id = wm.user_id
     WHERE wm.workspace_id = ?
     ORDER BY wm.created_at ASC`,
    [workspaceId]
  );

  const invites = await queryAll(
    `SELECT id, email, role, expires_at, created_at
     FROM workspace_invites
     WHERE workspace_id = ? AND accepted_at IS NULL AND expires_at > ?
     ORDER BY created_at DESC`,
    [workspaceId, nowIso()]
  );

  return {
    members: members.map((m) => ({
      user_id: m.user_id,
      name: m.name,
      email: m.email,
      role: m.role,
      status: "active",
      created_at: m.created_at
    })),
    invites: invites.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      status: "pending",
      expires_at: i.expires_at,
      created_at: i.created_at
    }))
  };
}

async function getInviteByToken(token) {
  const row = await queryOne(
    `SELECT wi.*, u.name AS inviter_name
     FROM workspace_invites wi
     LEFT JOIN users u ON u.id = wi.created_by_user_id
     WHERE wi.token = ?`,
    [token]
  );
  if (!row) return { ok: false, error: "not_found" };
  if (row.accepted_at) return { ok: false, error: "already_accepted" };
  if (Date.parse(row.expires_at) <= Date.now()) return { ok: false, error: "expired" };
  return {
    ok: true,
    invite: {
      id: row.id,
      workspace_id: row.workspace_id,
      email: row.email,
      role: row.role,
      expires_at: row.expires_at,
      inviter_name: row.inviter_name || null
    }
  };
}

async function createWorkspaceInvite({ workspaceId, email, role, invitedByUserId, inviterName }) {
  const normalized = normalizeEmail(email);
  if (!normalized.includes("@")) return { ok: false, statusCode: 400, error: "valid email required" };
  if (!isValidRole(role)) return { ok: false, statusCode: 400, error: "invalid role" };

  const existingUser = await queryOne("SELECT id FROM users WHERE email = ?", [normalized]);
  if (existingUser) {
    const already = await queryOne(
      "SELECT 1 AS ok FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
      [workspaceId, existingUser.id]
    );
    if (already) return { ok: false, statusCode: 409, error: "user_already_member" };
  }

  await run(
    `DELETE FROM workspace_invites
     WHERE workspace_id = ? AND LOWER(email) = ? AND accepted_at IS NULL`,
    [workspaceId, normalized]
  );

  const id = `winv_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
  const token = crypto.randomBytes(24).toString("hex");
  const created = nowIso();
  const expires = toIsoPlusMinutes(INVITE_TTL_HOURS * 60);

  await run(
    `INSERT INTO workspace_invites (
      id, workspace_id, email, role, token, expires_at, created_at, created_by_user_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, workspaceId, normalized, role, token, expires, created, invitedByUserId || null]
  );

  await writeAudit({
    workspaceId,
    releaseId: null,
    eventType: "WORKSPACE_INVITE_CREATED",
    actorType: "USER",
    actorName: inviterName || "user",
    details: { invite_id: id, email: normalized, role }
  });

  void sendWorkspaceInviteEmail({ to: normalized, token, role, inviterName }).catch((err) => {
    console.warn("[workspace_invite] email failed:", err?.message || err);
  });

  return {
    ok: true,
    invite: { id, email: normalized, role, token, expires_at: expires, status: "pending" }
  };
}

async function acceptWorkspaceInvite({ token, userId, userEmail }) {
  const preview = await getInviteByToken(token);
  if (!preview.ok) return preview;

  const invite = preview.invite;
  const normalized = normalizeEmail(userEmail);
  if (normalized !== normalizeEmail(invite.email)) {
    return { ok: false, statusCode: 403, error: "invite_email_mismatch" };
  }

  const user = await queryOne("SELECT * FROM users WHERE id = ?", [userId]);
  if (!user) return { ok: false, statusCode: 404, error: "user_not_found" };

  await ensureMemberRow({ workspaceId: invite.workspace_id, userId, role: invite.role });
  await run("UPDATE users SET workspace_id = ?, role = ? WHERE id = ?", [
    invite.workspace_id,
    invite.role,
    userId
  ]);
  await run(
    "UPDATE workspace_invites SET accepted_at = ?, accepted_user_id = ? WHERE id = ?",
    [nowIso(), userId, invite.id]
  );

  await writeAudit({
    workspaceId: invite.workspace_id,
    releaseId: null,
    eventType: "WORKSPACE_INVITE_ACCEPTED",
    actorType: "USER",
    actorName: user.email,
    details: { invite_id: invite.id, role: invite.role }
  });

  const fresh = await queryOne("SELECT * FROM users WHERE id = ?", [userId]);
  return { ok: true, user: fresh, workspace_id: invite.workspace_id, role: invite.role };
}

async function registerUserWithInvite({ email, password, name, inviteToken, passwordHash, displayName, userId }) {
  const preview = await getInviteByToken(inviteToken);
  if (!preview.ok) return preview;

  const invite = preview.invite;
  if (normalizeEmail(email) !== normalizeEmail(invite.email)) {
    return { ok: false, statusCode: 400, error: "invite_email_mismatch" };
  }

  const existing = await queryOne("SELECT id FROM users WHERE email = ?", [normalizeEmail(email)]);
  if (existing) return { ok: false, statusCode: 409, error: "email_already_registered" };

  const ts = nowIso();
  await run(
    "INSERT INTO users (id, email, password_hash, name, workspace_id, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [userId, normalizeEmail(email), passwordHash, displayName, invite.workspace_id, invite.role, ts]
  );
  await ensureMemberRow({ workspaceId: invite.workspace_id, userId, role: invite.role, createdAt: ts });
  await run(
    "UPDATE workspace_invites SET accepted_at = ?, accepted_user_id = ? WHERE id = ?",
    [ts, userId, invite.id]
  );

  await writeAudit({
    workspaceId: invite.workspace_id,
    releaseId: null,
    eventType: "WORKSPACE_INVITE_ACCEPTED",
    actorType: "USER",
    actorName: normalizeEmail(email),
    details: { invite_id: invite.id, role: invite.role, via: "register" }
  });

  return { ok: true, workspace_id: invite.workspace_id, role: invite.role };
}

async function updateMemberRole({ workspaceId, targetUserId, role, actorEmail }) {
  if (!isValidRole(role)) return { ok: false, statusCode: 400, error: "invalid role" };
  const member = await queryOne(
    "SELECT user_id FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
    [workspaceId, targetUserId]
  );
  if (!member) return { ok: false, statusCode: 404, error: "member_not_found" };

  await run("UPDATE workspace_members SET role = ? WHERE workspace_id = ? AND user_id = ?", [
    role,
    workspaceId,
    targetUserId
  ]);
  const user = await queryOne("SELECT workspace_id FROM users WHERE id = ?", [targetUserId]);
  if (user?.workspace_id === workspaceId) {
    await run("UPDATE users SET role = ? WHERE id = ?", [role, targetUserId]);
  }

  await writeAudit({
    workspaceId,
    releaseId: null,
    eventType: "WORKSPACE_MEMBER_ROLE_UPDATED",
    actorType: "USER",
    actorName: actorEmail || "user",
    details: { user_id: targetUserId, role }
  });

  return { ok: true };
}

async function removeMember({ workspaceId, targetUserId, actorUserId, actorEmail }) {
  if (targetUserId === actorUserId) {
    return { ok: false, statusCode: 400, error: "cannot_remove_self" };
  }
  const count = await queryOne(
    "SELECT COUNT(*) AS c FROM workspace_members WHERE workspace_id = ?",
    [workspaceId]
  );
  if (Number(count?.c || 0) <= 1) {
    return { ok: false, statusCode: 409, error: "cannot_remove_last_member" };
  }

  const removed = await run(
    "DELETE FROM workspace_members WHERE workspace_id = ? AND user_id = ?",
    [workspaceId, targetUserId]
  );
  if (!removed?.changes) return { ok: false, statusCode: 404, error: "member_not_found" };

  await writeAudit({
    workspaceId,
    releaseId: null,
    eventType: "WORKSPACE_MEMBER_REMOVED",
    actorType: "USER",
    actorName: actorEmail || "user",
    details: { user_id: targetUserId }
  });

  return { ok: true };
}

async function revokeInvite({ workspaceId, inviteId, actorEmail }) {
  const row = await queryOne(
    "SELECT id FROM workspace_invites WHERE id = ? AND workspace_id = ? AND accepted_at IS NULL",
    [inviteId, workspaceId]
  );
  if (!row) return { ok: false, statusCode: 404, error: "invite_not_found" };
  await run("DELETE FROM workspace_invites WHERE id = ?", [inviteId]);
  await writeAudit({
    workspaceId,
    releaseId: null,
    eventType: "WORKSPACE_INVITE_REVOKED",
    actorType: "USER",
    actorName: actorEmail || "user",
    details: { invite_id: inviteId }
  });
  return { ok: true };
}

module.exports = {
  VALID_ROLES,
  userHasWorkspaceAccess,
  getEffectiveRoleForWorkspace,
  ensureMemberRow,
  listWorkspaceMembersAndInvites,
  getInviteByToken,
  createWorkspaceInvite,
  acceptWorkspaceInvite,
  registerUserWithInvite,
  updateMemberRole,
  removeMember,
  revokeInvite
};
