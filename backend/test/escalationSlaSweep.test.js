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
const { nowIso } = require("../src/lib/time");

before(async () => {
  await initDatabase();
});

async function seedOverdueEscalation({ breached = 0, reminderSentAt = null, dueOffsetMs = -60_000 } = {}) {
  const ws = `ws_sla_${crypto.randomBytes(4).toString("hex")}`;
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

    const out = await runEscalationSlaSweep();
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

    await runEscalationSlaSweep();
    const reminderAfterFirst = (
      await queryOne("SELECT sla_reminder_sent_at FROM escalation_requests WHERE id = $1", [escId])
    ).sla_reminder_sent_at;
    assert.ok(reminderAfterFirst);

    await runEscalationSlaSweep();

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
    const { escId } = await seedOverdueEscalation({ dueOffsetMs: 60 * 60 * 1000 });

    const before = await queryOne("SELECT sla_breached, sla_reminder_sent_at FROM escalation_requests WHERE id = $1", [
      escId
    ]);
    assert.equal(Number(before.sla_breached), 0);
    assert.equal(before.sla_reminder_sent_at, null);

    await runEscalationSlaSweep();

    const after = await queryOne("SELECT sla_breached, sla_reminder_sent_at FROM escalation_requests WHERE id = $1", [
      escId
    ]);
    assert.equal(Number(after.sla_breached), 0);
    assert.equal(after.sla_reminder_sent_at, null);
  });

  it("bulk-marks multiple overdue escalations in one sweep", async () => {
    const a = await seedOverdueEscalation();
    const b = await seedOverdueEscalation();

    const out = await runEscalationSlaSweep();
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
});
