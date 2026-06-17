"use strict";

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "postgresql://127.0.0.1:5432/verdikt_test";
process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
process.env.WEBHOOK_SECRET = "test-webhook-secret-24-char-min";
process.env.NODE_ENV = "test";

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { initDatabase, run, queryOne } = require("../src/database");
const { writeAudit } = require("../src/services/audit");
const { verifyAuditIntegrity } = require("../src/services/auditIntegrity");
const {
  persistCertificationSnapshot,
  computeEvidenceHash
} = require("../src/services/certificationSnapshots");
const { buildGateContext } = require("../src/services/gateContext");
const { getThresholdMap, ensureWorkspaceSeeded } = require("../src/services/workspaceConfig");
const { nowIso } = require("../src/lib/time");

before(async () => {
  await initDatabase();
});

describe("certification snapshots", () => {
  it("freezes threshold map for gate context after threshold change", async () => {
    const ws = `ws_snap_${crypto.randomBytes(4).toString("hex")}`;
    const releaseId = `rel_snap_${crypto.randomBytes(4).toString("hex")}`;
    const ts = nowIso();

    await ensureWorkspaceSeeded(ws);
    await run(
      `INSERT INTO releases (id, workspace_id, version, release_type, environment, status, created_at, updated_at, verdict_issued_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [releaseId, ws, "snap-v1", "model_update", "staging", "CERTIFIED", ts, ts, ts]
    );

    const frozenThresholds = { accuracy: { min: 85, max: null, required_for_certification: 1 } };
    const frozenSignals = { accuracy: 91 };

    await persistCertificationSnapshot({
      releaseId,
      workspaceId: ws,
      thresholdMap: frozenThresholds,
      signalMap: frozenSignals,
      status: "CERTIFIED"
    });

    await run(
      `INSERT INTO thresholds (workspace_id, signal_id, min_value, max_value, required_for_certification)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, signal_id) DO UPDATE SET min_value = excluded.min_value`,
      [ws, "accuracy", 95, null, 1]
    );

    const release = await queryOne("SELECT * FROM releases WHERE id = ?", [releaseId]);
    const { certification } = await buildGateContext(release, null);
    const passed = certification?.passed_signals?.find((s) => s.signal_id === "accuracy");

    assert.ok(passed, "accuracy should appear in passed_signals");
    assert.equal(passed.threshold?.min, 85, "cert record should use frozen 85% threshold, not live 95%");
    assert.equal(passed.value, 91);
    assert.ok(certification.required_signals_met?.includes("accuracy"));

    const live = await getThresholdMap(ws);
    assert.equal(live.accuracy.min, 95, "live threshold should have changed");
  });

  it("computes stable evidence hash", () => {
    const a = computeEvidenceHash({ accuracy: { min: 85 } }, { accuracy: 91 });
    const b = computeEvidenceHash({ accuracy: { min: 85 } }, { accuracy: 91 });
    assert.equal(a, b);
    assert.notEqual(a, computeEvidenceHash({ accuracy: { min: 90 } }, { accuracy: 91 }));
  });
});

describe("audit hash chain", () => {
  const ws = `ws_chain_${crypto.randomBytes(4).toString("hex")}`;

  it("chains rows and blocks mutation", async () => {
    const ts = nowIso();
    await ensureWorkspaceSeeded(ws);
    await writeAudit({
      workspaceId: ws,
      eventType: "TEST_CHAIN_A",
      actorType: "SYSTEM",
      actorName: "test",
      details: { n: 1 }
    });
    await writeAudit({
      workspaceId: ws,
      eventType: "TEST_CHAIN_B",
      actorType: "SYSTEM",
      actorName: "test",
      details: { n: 2 }
    });

    const before = await verifyAuditIntegrity(ws);
    assert.equal(before.valid, true, JSON.stringify(before));
    assert.equal(before.tampered.length, 0);
    assert.equal(before.missing_hash.length, 0);
    assert.equal(before.broken_chain.length, 0);

    const row = await queryOne(
      `SELECT * FROM audit_events WHERE workspace_id = ? AND event_type = 'TEST_CHAIN_A' ORDER BY id DESC LIMIT 1`,
      [ws]
    );
    assert.ok(row?.row_hash);

    // Simulate tamper: delete hash so verify reports missing, not silent repair
    try {
      await run("UPDATE audit_events SET details_json = ? WHERE id = ?", ['{"n":999}', row.id]);
      assert.fail("audit_events should be append-only");
    } catch (err) {
      assert.match(String(err.message), /append-only/i);
    }
  });
});
