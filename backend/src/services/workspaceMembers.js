"use strict";

const crypto = require("crypto");
const { queryOne, queryAll, run, transaction } = require("../database");
const { nowIso, toIsoPlusMinutes } = require("../lib/time");
const { writeAudit } = require("./audit");
const { sendWorkspaceInviteEmail } = require("./email");
const { ensureWorkspaceSeeded } = require("./workspaceConfig");

/**
 * RBAC source of truth: workspace_members.role
 *
 * users.role is a denormalized cache for the user's home workspace (users.workspace_id).
 * Always read effective role via getEffectiveRoleForWorkspace().
 * Always write roles through ensureMemberRow / updateMemberRole / syncHomeWorkspaceRoleCache().
 */

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
    "SELECT 1 AS ok FROM workspace_members WHERE user_id = $1 AND workspace_id = $2",
    [userId, workspaceId]
  );
  if (member) return true;
  const user = await queryOne("SELECT workspace_id FROM users WHERE id = $1", [userId]);
  return user?.workspace_id === workspaceId;
}

async function getEffectiveRoleForWorkspace(userId, workspaceId) {
  const member = await queryOne(
    "SELECT role FROM workspace_members WHERE user_id = $1 AND workspace_id = $2",
    [userId, workspaceId]
  );
  if (member?.role) return member.role;
  const user = await queryOne("SELECT role, workspace_id FROM users WHERE id = $1", [userId]);
  if (user?.workspace_id === workspaceId) return user.role;
  return null;
}

const DEFAULT_DB = { run, queryOne };

async function syncHomeWorkspaceRoleCache(userId, workspaceId, role, db = DEFAULT_DB) {
  await db.run("UPDATE users SET role = $1 WHERE id = $2 AND workspace_id = $3", [role, userId, workspaceId]);
}

async function ensureMemberRow({ workspaceId, userId, role, createdAt = null, db = DEFAULT_DB }) {
  const ts = createdAt || nowIso();
  await db.run(
    `INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = excluded.role`,
    [workspaceId, userId, role, ts]
  );
  await syncHomeWorkspaceRoleCache(userId, workspaceId, role, db);
}

/**
 * Pending → accepted compare-and-set. Returns the claimed invite, or null when it
 * was revoked or replaced (row deleted) or accepted concurrently.
 */
async function claimPendingInvite(tx, inviteId, userId, ts) {
  return tx.queryOne(
    `UPDATE workspace_invites SET accepted_at = $1, accepted_user_id = $2
      WHERE id = $3 AND accepted_at IS NULL
      RETURNING id, workspace_id, role`,
    [ts, userId, inviteId]
  );
}

async function listWorkspaceMembersAndInvites(workspaceId) {
  const members = await queryAll(
    `SELECT u.id AS user_id, u.name, u.email, wm.role, wm.created_at
     FROM workspace_members wm
     JOIN users u ON u.id = wm.user_id
     WHERE wm.workspace_id = $1
     ORDER BY wm.created_at ASC`,
    [workspaceId]
  );

  const invites = await queryAll(
    `SELECT id, email, role, expires_at, created_at
     FROM workspace_invites
     WHERE workspace_id = $1 AND accepted_at IS NULL AND expires_at > $2
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
     WHERE wi.token = $1`,
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

  const existingUser = await queryOne("SELECT id FROM users WHERE email = $1", [normalized]);
  if (existingUser) {
    const already = await queryOne(
      "SELECT 1 AS ok FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
      [workspaceId, existingUser.id]
    );
    if (already) return { ok: false, statusCode: 409, error: "user_already_member" };
  }

  await run(
    `DELETE FROM workspace_invites
     WHERE workspace_id = $1 AND LOWER(email) = $2 AND accepted_at IS NULL`,
    [workspaceId, normalized]
  );

  const id = `winv_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
  const token = crypto.randomBytes(24).toString("hex");
  const created = nowIso();
  const expires = toIsoPlusMinutes(INVITE_TTL_HOURS * 60);

  await run(
    `INSERT INTO workspace_invites (
      id, workspace_id, email, role, token, expires_at, created_at, created_by_user_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
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

  const user = await queryOne("SELECT * FROM users WHERE id = $1", [userId]);
  if (!user) return { ok: false, statusCode: 404, error: "user_not_found" };

  const homeRole =
    user.workspace_id && user.workspace_id !== invite.workspace_id
      ? (await getEffectiveRoleForWorkspace(userId, user.workspace_id)) || user.role || "viewer"
      : null;

  const claimed = await transaction(async (tx) => {
    const claim = await claimPendingInvite(tx, invite.id, userId, nowIso());
    if (!claim) return null;
    if (homeRole) {
      await ensureMemberRow({ workspaceId: user.workspace_id, userId, role: homeRole, db: tx });
    }
    await ensureMemberRow({ workspaceId: claim.workspace_id, userId, role: claim.role, db: tx });
    await tx.run("UPDATE users SET workspace_id = $1 WHERE id = $2", [claim.workspace_id, userId]);
    await syncHomeWorkspaceRoleCache(userId, claim.workspace_id, claim.role, tx);
    await writeAudit({
      workspaceId: claim.workspace_id,
      releaseId: null,
      eventType: "WORKSPACE_INVITE_ACCEPTED",
      actorType: "USER",
      actorName: user.email,
      details: { invite_id: claim.id, role: claim.role },
      tx
    });
    return claim;
  });
  if (!claimed) return { ok: false, statusCode: 404, error: "not_found" };

  const fresh = await queryOne("SELECT * FROM users WHERE id = $1", [userId]);
  return { ok: true, user: fresh, workspace_id: claimed.workspace_id, role: claimed.role };
}

async function registerUserWithInvite({
  email,
  password: _password,
  name: _name,
  inviteToken,
  passwordHash,
  displayName,
  userId
}) {
  const preview = await getInviteByToken(inviteToken);
  if (!preview.ok) return preview;

  const invite = preview.invite;
  if (normalizeEmail(email) !== normalizeEmail(invite.email)) {
    return { ok: false, statusCode: 400, error: "invite_email_mismatch" };
  }

  const existing = await queryOne("SELECT id FROM users WHERE email = $1", [normalizeEmail(email)]);
  if (existing) return { ok: false, statusCode: 409, error: "email_already_registered" };

  const ts = nowIso();
  const claimed = await transaction(async (tx) => {
    const claim = await claimPendingInvite(tx, invite.id, userId, ts);
    if (!claim) return null;
    await tx.run(
      "INSERT INTO users (id, email, password_hash, name, workspace_id, role, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [userId, normalizeEmail(email), passwordHash, displayName, claim.workspace_id, claim.role, ts]
    );
    await ensureMemberRow({ workspaceId: claim.workspace_id, userId, role: claim.role, createdAt: ts, db: tx });
    await writeAudit({
      workspaceId: claim.workspace_id,
      releaseId: null,
      eventType: "WORKSPACE_INVITE_ACCEPTED",
      actorType: "USER",
      actorName: normalizeEmail(email),
      details: { invite_id: claim.id, role: claim.role, via: "register" },
      tx
    });
    return claim;
  });
  if (!claimed) return { ok: false, statusCode: 404, error: "not_found" };

  return { ok: true, workspace_id: claimed.workspace_id, role: claimed.role };
}

async function updateMemberRole({ workspaceId, targetUserId, role, actorEmail }) {
  if (!isValidRole(role)) return { ok: false, statusCode: 400, error: "invalid role" };
  const member = await queryOne(
    "SELECT user_id FROM workspace_members WHERE workspace_id = $1 AND user_id = $2",
    [workspaceId, targetUserId]
  );
  if (!member) return { ok: false, statusCode: 404, error: "member_not_found" };

  await run("UPDATE workspace_members SET role = $1 WHERE workspace_id = $2 AND user_id = $3", [
    role,
    workspaceId,
    targetUserId
  ]);
  await syncHomeWorkspaceRoleCache(targetUserId, workspaceId, role);

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

  const outcome = await transaction(async (tx) => {
    // Lock the workspace's member rows so concurrent removals cannot both pass the last-member check.
    const members = await tx.queryAll(
      "SELECT user_id FROM workspace_members WHERE workspace_id = $1 FOR UPDATE",
      [workspaceId]
    );
    if (members.length <= 1) return { ok: false, statusCode: 409, error: "cannot_remove_last_member" };
    if (!members.some((m) => m.user_id === targetUserId)) {
      return { ok: false, statusCode: 404, error: "member_not_found" };
    }

    await tx.run("DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2", [
      workspaceId,
      targetUserId
    ]);
    const rehomedTo = await rehomeRemovedMember(tx, targetUserId, workspaceId);
    await writeAudit({
      workspaceId,
      releaseId: null,
      eventType: "WORKSPACE_MEMBER_REMOVED",
      actorType: "USER",
      actorName: actorEmail || "user",
      details: { user_id: targetUserId },
      tx
    });
    return { ok: true, rehomedTo };
  });
  if (!outcome.ok) return outcome;

  if (outcome.rehomedTo?.created) {
    await ensureWorkspaceSeeded(outcome.rehomedTo.workspaceId);
  }
  return { ok: true };
}

/**
 * users.workspace_id / users.role act as a legacy access fallback (see
 * userHasWorkspaceAccess), so a removed member whose home is the removed
 * workspace must be moved: to their oldest remaining membership, or to a new
 * personal workspace (the same state as a fresh signup) when none remain.
 */
async function rehomeRemovedMember(tx, userId, removedWorkspaceId) {
  const user = await tx.queryOne("SELECT workspace_id FROM users WHERE id = $1", [userId]);
  if (!user || user.workspace_id !== removedWorkspaceId) return null;

  const other = await tx.queryOne(
    `SELECT workspace_id, role FROM workspace_members
      WHERE user_id = $1 AND workspace_id <> $2
      ORDER BY created_at ASC LIMIT 1`,
    [userId, removedWorkspaceId]
  );
  if (other) {
    await tx.run("UPDATE users SET workspace_id = $1, role = $2 WHERE id = $3", [
      other.workspace_id,
      other.role,
      userId
    ]);
    return { workspaceId: other.workspace_id, created: false };
  }

  const personalWorkspaceId = `ws_${crypto.randomBytes(8).toString("hex")}`;
  await tx.run("UPDATE users SET workspace_id = $1, role = $2 WHERE id = $3", [
    personalWorkspaceId,
    "org_admin",
    userId
  ]);
  await ensureMemberRow({ workspaceId: personalWorkspaceId, userId, role: "org_admin", db: tx });
  return { workspaceId: personalWorkspaceId, created: true };
}

async function revokeInvite({ workspaceId, inviteId, actorEmail }) {
  const row = await queryOne(
    "SELECT id FROM workspace_invites WHERE id = $1 AND workspace_id = $2 AND accepted_at IS NULL",
    [inviteId, workspaceId]
  );
  if (!row) return { ok: false, statusCode: 404, error: "invite_not_found" };
  await run("DELETE FROM workspace_invites WHERE id = $1", [inviteId]);
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

async function listWorkspacesForUser(userId) {
  const members = await queryAll(
    `SELECT wm.workspace_id, wm.role, wm.created_at
     FROM workspace_members wm
     WHERE wm.user_id = $1
     ORDER BY wm.created_at ASC`,
    [userId]
  );
  const user = await queryOne("SELECT workspace_id, role FROM users WHERE id = $1", [userId]);
  const byId = new Map();
  for (const m of members) {
    byId.set(m.workspace_id, { workspace_id: m.workspace_id, role: m.role });
  }
  if (user?.workspace_id && !byId.has(user.workspace_id)) {
    byId.set(user.workspace_id, { workspace_id: user.workspace_id, role: user.role });
  }
  return Array.from(byId.values());
}

async function listActiveWorkspacesForInternalViewer() {
  const rows = await queryAll(
    `SELECT workspace_id, MIN(role) AS role
     FROM (
       SELECT workspace_id, role FROM users WHERE workspace_id IS NOT NULL
       UNION ALL
       SELECT workspace_id, role FROM workspace_members WHERE workspace_id IS NOT NULL
       UNION ALL
       SELECT workspace_id, 'internal_viewer' AS role FROM workspace_policies WHERE workspace_id IS NOT NULL
     ) active_workspaces
     GROUP BY workspace_id
     ORDER BY workspace_id ASC`
  );
  return rows.map((row) => ({
    workspace_id: row.workspace_id,
    role: row.role || "internal_viewer"
  }));
}

module.exports = {
  VALID_ROLES,
  userHasWorkspaceAccess,
  getEffectiveRoleForWorkspace,
  syncHomeWorkspaceRoleCache,
  ensureMemberRow,
  listWorkspaceMembersAndInvites,
  listWorkspacesForUser,
  listActiveWorkspacesForInternalViewer,
  getInviteByToken,
  createWorkspaceInvite,
  acceptWorkspaceInvite,
  registerUserWithInvite,
  updateMemberRole,
  removeMember,
  revokeInvite
};
