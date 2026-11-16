"use strict";

/**
 * Regression tests for lifecycle state machines outside release status:
 * certification snapshots, merge promotion, auth tokens, invites, membership,
 * and escalation reminders. See docs/STATE_MACHINES.md.
 */

require("./helpers/backendFixtures");

const crypto = require("crypto");
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");

const { run, queryOne } = require("../src/database");
const { createApp } = require("./helpers/backendFixtures");
const { ensureWorkspaceSeeded, evaluateReleaseAfterSignalIngest } = require("../src/services/domain");
const {
  getCertificationSnapshot,
  persistCertificationSnapshot
} = require("../src/services/certificationSnapshots");
const { promoteReleaseOnMerge } = require("../src/services/releaseEnvironment");
const {
  createWorkspaceInvite,
  acceptWorkspaceInvite,
  removeMember,
  ensureMemberRow,
  userHasWorkspaceAccess,
  getEffectiveRoleForWorkspace
} = require("../src/services/workspaceMembers");
const { createEscalationRequest, runEscalationSlaSweep } = require("../src/services/escalations");
const { nowIso } = require("../src/lib/time");
const {
  rid,
  seedWorkspaceWithRequiredSignals,
  insertRelease,
  insertSignal,
  auditCount,
  interleaveWithHeldRowLock
} = require("./helpers/stateMachineFixtures");

async function insertUser({ workspaceId, role = "engineer" }) {
  const id = crypto.randomUUID();
  const email = `${rid("user")}@example.test`;
  await run(
    "INSERT INTO users (id, email, password_hash, name, workspace_id, role, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [id, email, "x", "Test User", workspaceId, role, nowIso()]
  );
  await ensureMemberRow({ workspaceId, userId: id, role });
  return { id, email };
}

async function workspaceAuditCount(workspaceId, eventType) {
  const row = await queryOne(
    "SELECT COUNT(*) AS c FROM audit_events WHERE workspace_id = $1 AND event_type = $2",
    [workspaceId, eventType]
  );
  return Number(row?.c || 0);
}

describe("certification snapshot follows the verdict until it is cert-like", () => {
  it("an UNCERTIFIED-era snapshot is replaced when the release later certifies", async () => {
    const wsId = await seedWorkspaceWithRequiredSignals();
    const release = await insertRelease(wsId, { deadlineOffsetMs: -60_000 });
    await insertSignal(release.id, "accuracy", 10);
    await insertSignal(release.id, "safety", 90);

    const first = await evaluateReleaseAfterSignalIngest(release, release.id, "test", 2);
    assert.equal(first?.status, "UNCERTIFIED");
    assert.equal((await getCertificationSnapshot(release.id)).status_at_verdict, "UNCERTIFIED");

    await insertSignal(release.id, "accuracy", 95);
    const fresh = await queryOne("SELECT * FROM releases WHERE id = $1", [release.id]);
    const second = await evaluateReleaseAfterSignalIngest(fresh, release.id, "test", 1);
    assert.equal(second?.status, "CERTIFIED");

    const snapshot = await getCertificationSnapshot(release.id);
    assert.equal(snapshot.status_at_verdict, "CERTIFIED");
    assert.equal(Number(snapshot.signal_map.accuracy), 95);
  });

  it("a certified snapshot stays frozen against later non-override writes", async () => {
    const wsId = await seedWorkspaceWithRequiredSignals();
    const release = await insertRelease(wsId, { status: "CERTIFIED", verdictIssued: true });
    const base = { releaseId: release.id, workspaceId: wsId, thresholdMap: { accuracy: { min: 50 } } };
    await persistCertificationSnapshot({ ...base, signalMap: { accuracy: 95 }, status: "CERTIFIED" });
    const frozen = await getCertificationSnapshot(release.id);

    await persistCertificationSnapshot({ ...base, signalMap: { accuracy: 10 }, status: "UNCERTIFIED" });

    const after = await getCertificationSnapshot(release.id);
    assert.equal(after.status_at_verdict, "CERTIFIED");
    assert.equal(after.evidence_hash, frozen.evidence_hash);
  });
});

describe("merge promotion happens once per release", () => {
  it("a redelivered merge event after a revoke does not re-flag a bypass or re-audit", async () => {
    const wsId = await seedWorkspaceWithRequiredSignals();
    const release = await insertRelease(wsId, { status: "CERTIFIED", verdictIssued: true, environment: "pre-prod" });
    const merge = { workspaceId: wsId, prNumber: 7, baseBranch: "main", newEnv: "prod", isMainBranch: true };

    const first = await promoteReleaseOnMerge(release, merge);
    assert.equal(first.promoted, true);
    assert.equal(first.shipped_without_certification, false);

    await run("UPDATE releases SET status = 'CERTIFICATION_REVOKED' WHERE id = $1", [release.id]);
    const stale = await queryOne("SELECT * FROM releases WHERE id = $1", [release.id]);
    const redelivered = await promoteReleaseOnMerge(stale, merge);

    assert.equal(redelivered.promoted, false);
    assert.equal(redelivered.already_promoted, true);
    const row = await queryOne(
      "SELECT environment, shipped_without_certification FROM releases WHERE id = $1",
      [release.id]
    );
    assert.equal(row.environment, "prod");
    assert.equal(Number(row.shipped_without_certification), 0);
    assert.equal(await auditCount(release.id, "RELEASE_ENV_PROMOTED"), 1);
    assert.equal(await auditCount(release.id, "RELEASE_SHIPPED_WITHOUT_CERTIFICATION"), 0);
  });
});

describe("password reset token is single use", () => {
  it("two concurrent resets with one token: exactly one succeeds", async () => {
    const app = createApp();
    const email = `${rid("reset")}@example.test`;
    await request(app).post("/api/auth/register").send({ email, password: "oldpass12", name: "RP" }).expect(200);
    const forgot = await request(app).post("/api/auth/forgot-password").send({ email }).expect(200);
    const token = forgot.body.reset_token;

    const [a, b] = await Promise.all([
      request(app).post("/api/auth/reset-password").send({ token, password: "firstpass12" }),
      request(app).post("/api/auth/reset-password").send({ token, password: "secondpass12" })
    ]);

    assert.deepEqual([a.status, b.status].sort(), [200, 400]);
  });
});

describe("workspace invite acceptance", () => {
  it("concurrent accepts of one invite record one acceptance", async () => {
    const wsId = rid("ws_inv");
    await ensureWorkspaceSeeded(wsId);
    const owner = await insertUser({ workspaceId: wsId, role: "org_admin" });
    const inviteeHome = rid("ws_home");
    await ensureWorkspaceSeeded(inviteeHome);
    const invitee = await insertUser({ workspaceId: inviteeHome, role: "org_admin" });
    const created = await createWorkspaceInvite({
      workspaceId: wsId,
      email: invitee.email,
      role: "engineer",
      invitedByUserId: owner.id,
      inviterName: "Owner"
    });

    const outcomes = await Promise.all(
      Array.from({ length: 3 }, () =>
        acceptWorkspaceInvite({ token: created.invite.token, userId: invitee.id, userEmail: invitee.email })
      )
    );

    assert.equal(outcomes.filter((o) => o.ok).length, 1);
    assert.equal(await workspaceAuditCount(wsId, "WORKSPACE_INVITE_ACCEPTED"), 1);
  });

  it("an invite revoked while acceptance is in flight grants no membership", async () => {
    const wsId = rid("ws_inv");
    await ensureWorkspaceSeeded(wsId);
    const owner = await insertUser({ workspaceId: wsId, role: "org_admin" });
    const inviteeHome = rid("ws_home");
    await ensureWorkspaceSeeded(inviteeHome);
    const invitee = await insertUser({ workspaceId: inviteeHome, role: "org_admin" });
    const created = await createWorkspaceInvite({
      workspaceId: wsId,
      email: invitee.email,
      role: "vp_engineering",
      invitedByUserId: owner.id,
      inviterName: "Owner"
    });

    const { result } = await interleaveWithHeldRowLock(
      { lockSql: "SELECT id FROM workspace_invites WHERE id = $1 FOR UPDATE", lockParams: [created.invite.id] },
      (client) => client.query("DELETE FROM workspace_invites WHERE id = $1", [created.invite.id]),
      () => acceptWorkspaceInvite({ token: created.invite.token, userId: invitee.id, userEmail: invitee.email })
    );

    assert.equal(result.ok, false);
    assert.equal(await userHasWorkspaceAccess(invitee.id, wsId), false);
  });
});

describe("workspace member removal revokes access", () => {
  it("a removed member whose home is the workspace loses access and role", async () => {
    const wsId = rid("ws_rm");
    await ensureWorkspaceSeeded(wsId);
    const owner = await insertUser({ workspaceId: wsId, role: "org_admin" });
    const member = await insertUser({ workspaceId: wsId, role: "vp_engineering" });

    const out = await removeMember({ workspaceId: wsId, targetUserId: member.id, actorUserId: owner.id });

    assert.equal(out.ok, true);
    assert.equal(await userHasWorkspaceAccess(member.id, wsId), false);
    assert.equal(await getEffectiveRoleForWorkspace(member.id, wsId), null);
    const user = await queryOne("SELECT workspace_id FROM users WHERE id = $1", [member.id]);
    assert.notEqual(user.workspace_id, wsId);
    assert.equal(await userHasWorkspaceAccess(member.id, user.workspace_id), true);
  });

  it("a removed member returns to their remaining workspace", async () => {
    const wsId = rid("ws_rm");
    const otherWs = rid("ws_other");
    await ensureWorkspaceSeeded(wsId);
    await ensureWorkspaceSeeded(otherWs);
    const owner = await insertUser({ workspaceId: wsId, role: "org_admin" });
    const member = await insertUser({ workspaceId: otherWs, role: "tech_lead" });
    await ensureMemberRow({ workspaceId: wsId, userId: member.id, role: "engineer" });
    await run("UPDATE users SET workspace_id = $1 WHERE id = $2", [wsId, member.id]);

    await removeMember({ workspaceId: wsId, targetUserId: member.id, actorUserId: owner.id });

    const user = await queryOne("SELECT workspace_id, role FROM users WHERE id = $1", [member.id]);
    assert.equal(user.workspace_id, otherWs);
    assert.equal(user.role, "tech_lead");
    assert.equal(await userHasWorkspaceAccess(member.id, wsId), false);
  });

  it("two admins removing each other concurrently leave a member behind", async () => {
    const wsId = rid("ws_rm");
    await ensureWorkspaceSeeded(wsId);
    const a = await insertUser({ workspaceId: wsId, role: "org_admin" });
    const b = await insertUser({ workspaceId: wsId, role: "org_admin" });

    await Promise.all([
      removeMember({ workspaceId: wsId, targetUserId: b.id, actorUserId: a.id }),
      removeMember({ workspaceId: wsId, targetUserId: a.id, actorUserId: b.id })
    ]);

    const remaining = await queryOne("SELECT COUNT(*) AS c FROM workspace_members WHERE workspace_id = $1", [wsId]);
    assert.equal(Number(remaining.c), 1);
  });
});

describe("escalation SLA reminder delivery", () => {
  it("a failed reminder email is not recorded as sent", async () => {
    const wsId = await seedWorkspaceWithRequiredSignals();
    const release = await insertRelease(wsId, { status: "UNCERTIFIED", deadlineOffsetMs: -60_000, verdictIssued: true });
    const { escalation } = await createEscalationRequest({
      workspaceId: wsId,
      releaseId: release.id,
      reason: "blocked",
      requestedByType: "AGENT",
      requestedByName: "agent",
      releaseStatus: "UNCERTIFIED"
    });
    await run("UPDATE escalation_requests SET sla_due_at = $1 WHERE id = $2", [
      new Date(Date.now() - 60_000).toISOString(),
      escalation.id
    ]);

    const stats = await runEscalationSlaSweep({
      workspaceId: wsId,
      workerId: rid("sla-fail"),
      resolveRecipientsFn: async () => ["reviewer@example.test"],
      sendReminderFn: async () => ({ ok: false, error: "resend 503" })
    });

    assert.equal(stats.failed, 1);
    const row = await queryOne(
      "SELECT sla_breached, sla_reminder_sent_at FROM escalation_requests WHERE id = $1",
      [escalation.id]
    );
    assert.equal(Number(row.sla_breached), 1);
    assert.equal(row.sla_reminder_sent_at, null);
  });
});
