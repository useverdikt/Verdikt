"use strict";

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "postgresql://127.0.0.1:5432/verdikt_test";
process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
process.env.WEBHOOK_SECRET = "test-webhook-secret-24-char-min";
process.env.NODE_ENV = "test";
delete process.env.ESCALATION_NOTIFY_EMAIL;

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { initDatabase, run, queryOne, queryAll } = require("../src/database");
const { ensureWorkspaceSeeded } = require("../src/services/workspaceConfig");
const { runEscalationSlaSweep, PENDING } = require("../src/services/escalations");
const {
  claimDueEscalations,
  completeEscalationSlaSweepClaim,
  ownsActiveEscalationSlaSweepClaim,
  recordEscalationSlaSweepClaimFailure
} = require("../src/services/escalationSlaSweepClaims");
const { nowIso } = require("../src/lib/time");

before(async () => {
  await initDatabase();
});

async function seedOverdueEscalation({
  breached = 0,
  reminderSentAt = null,
  dueOffsetMs = -60_000,
  workspaceId = null
} = {}) {
  const ws = workspaceId || `ws_sla_${crypto.randomBytes(4).toString("hex")}`;
  const releaseId = `rel_sla_${crypto.randomBytes(4).toString("hex")}`;
  const escId = `esc_sla_${crypto.randomBytes(4).toString("hex")}`;
  const ts = nowIso();
  const dueAt = new Date(Date.now() + dueOffsetMs).toISOString();

  await ensureWorkspaceSeeded(ws);
  await run(
    `INSERT INTO releases (id, workspace_id, version, release_type, environment, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [releaseId, ws, "sla-v1", "model_update", "staging", "UNCERTIFIED", ts, ts]
  );
  await run(
    `INSERT INTO escalation_requests (
      id, workspace_id, release_id, state, reason, blocking_signals_json, attempted_fixes_json,
      requested_by_type, requested_by_name, release_status, created_at, updated_at,
      sla_due_at, sla_breached, sla_reminder_sent_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      escId,
      ws,
      releaseId,
      PENDING,
      "SLA sweep test",
      "[]",
      "[]",
      "SYSTEM",
      "test",
      "UNCERTIFIED",
      ts,
      ts,
      dueAt,
      breached,
      reminderSentAt
    ]
  );

  return { ws, releaseId, escId };
}

describe("escalation SLA sweep behavior", () => {
  it("marks overdue escalations breached and writes ESCALATION_SLA_BREACHED audit", async () => {
    const { ws, releaseId, escId } = await seedOverdueEscalation();

    const out = await runEscalationSlaSweep({
      workspaceId: ws,
      workerId: "sla-test-worker-1"
    });
    assert.ok(out.breached >= 1);
    assert.ok(out.reminders >= 1);

    const row = await queryOne("SELECT * FROM escalation_requests WHERE id = $1", [escId]);
    assert.equal(Number(row.sla_breached), 1);
    assert.ok(row.sla_reminder_sent_at, "reminder timestamp should be set even without notify recipients");

    const audits = await queryAll(
      `SELECT * FROM audit_events
        WHERE workspace_id = $1 AND release_id = $2 AND event_type = 'ESCALATION_SLA_BREACHED'`,
      [ws, releaseId]
    );
    assert.equal(audits.length, 1);
    assert.match(String(audits[0].details_json || ""), new RegExp(escId));
  });

  it("is idempotent on a second sweep (no duplicate breach audits)", async () => {
    const { ws, releaseId, escId } = await seedOverdueEscalation();

    await runEscalationSlaSweep({ workspaceId: ws, workerId: "sla-test-worker-2" });
    const reminderAfterFirst = (
      await queryOne("SELECT sla_reminder_sent_at FROM escalation_requests WHERE id = $1", [escId])
    ).sla_reminder_sent_at;
    assert.ok(reminderAfterFirst);

    await runEscalationSlaSweep({ workspaceId: ws, workerId: "sla-test-worker-2" });

    const row = await queryOne("SELECT * FROM escalation_requests WHERE id = $1", [escId]);
    assert.equal(Number(row.sla_breached), 1);
    assert.equal(row.sla_reminder_sent_at, reminderAfterFirst);

    const audits = await queryAll(
      `SELECT * FROM audit_events
        WHERE workspace_id = $1 AND release_id = $2 AND event_type = 'ESCALATION_SLA_BREACHED'`,
      [ws, releaseId]
    );
    assert.equal(audits.length, 1);
  });

  it("skips escalations that are not yet due", async () => {
    const { ws, escId } = await seedOverdueEscalation({ dueOffsetMs: 60 * 60 * 1000 });

    const before = await queryOne("SELECT sla_breached, sla_reminder_sent_at FROM escalation_requests WHERE id = $1", [
      escId
    ]);
    assert.equal(Number(before.sla_breached), 0);
    assert.equal(before.sla_reminder_sent_at, null);

    await runEscalationSlaSweep({ workspaceId: ws, workerId: "sla-test-worker-3" });

    const after = await queryOne("SELECT sla_breached, sla_reminder_sent_at FROM escalation_requests WHERE id = $1", [
      escId
    ]);
    assert.equal(Number(after.sla_breached), 0);
    assert.equal(after.sla_reminder_sent_at, null);
  });

  it("skips malformed legacy SLA dates without failing the batch", async () => {
    const { ws, escId } = await seedOverdueEscalation();
    await run("UPDATE escalation_requests SET sla_due_at = 'not-a-date' WHERE id = $1", [escId]);

    const out = await runEscalationSlaSweep({
      workspaceId: ws,
      workerId: "sla-test-worker-invalid-date"
    });

    assert.deepEqual(out, {
      processed: 0,
      breached: 0,
      reminders: 0,
      failed: 0
    });
  });

  it("bulk-marks multiple overdue escalations in one sweep", async () => {
    const a = await seedOverdueEscalation();
    const b = await seedOverdueEscalation({ workspaceId: a.ws });

    const out = await runEscalationSlaSweep({
      workspaceId: a.ws,
      workerId: "sla-test-worker-4"
    });
    assert.ok(out.breached >= 2);
    assert.ok(out.processed >= 2);

    for (const escId of [a.escId, b.escId]) {
      const row = await queryOne("SELECT sla_breached, sla_reminder_sent_at FROM escalation_requests WHERE id = $1", [
        escId
      ]);
      assert.equal(Number(row.sla_breached), 1);
      assert.ok(row.sla_reminder_sent_at);
    }
  });

  it("lets concurrent workers send one reminder and append one breach audit", async () => {
    const { ws, releaseId } = await seedOverdueEscalation();
    let reminderCalls = 0;
    const options = {
      workspaceId: ws,
      resolveRecipientsFn: async () => ["reviewer@example.com"],
      sendReminderFn: async () => {
        reminderCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { ok: true };
      }
    };

    const [workerA, workerB] = await Promise.all([
      runEscalationSlaSweep({ ...options, workerId: "sla-concurrent-a" }),
      runEscalationSlaSweep({ ...options, workerId: "sla-concurrent-b" })
    ]);

    assert.equal(workerA.processed + workerB.processed, 1);
    assert.equal(workerA.breached + workerB.breached, 1);
    assert.equal(workerA.reminders + workerB.reminders, 1);
    assert.equal(reminderCalls, 1);

    const audits = await queryAll(
      `SELECT id FROM audit_events
        WHERE workspace_id = $1
          AND release_id = $2
          AND event_type = 'ESCALATION_SLA_BREACHED'`,
      [ws, releaseId]
    );
    assert.equal(audits.length, 1);
  });

  it("recovers expired leases and scopes completion to the current owner", async () => {
    const { ws, escId } = await seedOverdueEscalation();
    const claimed = await claimDueEscalations({
      limit: 1,
      workerId: "sla-claim-owner",
      leaseMs: 60_000,
      workspaceId: ws
    });
    assert.deepEqual(claimed.map((row) => row.id), [escId]);
    assert.equal(await ownsActiveEscalationSlaSweepClaim(escId, "sla-claim-owner"), true);
    assert.equal(await ownsActiveEscalationSlaSweepClaim(escId, "different-worker"), false);

    await recordEscalationSlaSweepClaimFailure(
      escId,
      "sla-claim-owner",
      new Error("temporary reminder failure")
    );
    const failedClaim = await queryOne(
      "SELECT last_error FROM escalation_sla_sweep_claims WHERE escalation_id = $1",
      [escId]
    );
    assert.match(failedClaim.last_error, /temporary reminder failure/);

    const wrongOwner = await completeEscalationSlaSweepClaim(escId, "different-worker");
    assert.equal(wrongOwner.changes, 0);

    await run(
      `UPDATE escalation_sla_sweep_claims
          SET lease_until = NOW() - INTERVAL '1 second'
        WHERE escalation_id = $1`,
      [escId]
    );
    const recovered = await claimDueEscalations({
      limit: 1,
      workerId: "sla-recovery-worker",
      leaseMs: 60_000,
      workspaceId: ws
    });
    assert.deepEqual(recovered.map((row) => row.id), [escId]);

    const recoveredClaim = await queryOne(
      `SELECT claimed_by, attempt_count
         FROM escalation_sla_sweep_claims
        WHERE escalation_id = $1`,
      [escId]
    );
    assert.equal(recoveredClaim.claimed_by, "sla-recovery-worker");
    assert.equal(Number(recoveredClaim.attempt_count), 2);

    const completed = await completeEscalationSlaSweepClaim(escId, "sla-recovery-worker");
    assert.equal(completed.changes, 1);
    assert.equal(await ownsActiveEscalationSlaSweepClaim(escId, "sla-recovery-worker"), false);
  });
});
