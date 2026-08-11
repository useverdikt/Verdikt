"use strict";

process.env.NODE_ENV = "test";
process.env.OUTBOX_MODE = "shadow";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "postgresql://127.0.0.1:5432/verdikt_test";
process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
process.env.WEBHOOK_SECRET = "test-webhook-secret-24-char-min";

const crypto = require("crypto");
const { before, afterEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { initDatabase, queryAll, queryOne, run, transaction } = require("../src/database");
const { nowIso } = require("../src/lib/time");
const { ensureWorkspaceSeeded } = require("../src/services/workspaceConfig");
const { upsertReleaseIntelligence } = require("../src/services/intelligenceBuilder");
const {
  applyReleaseOverride,
  OVERRIDE_EFFECT_TYPES
} = require("../src/services/releaseOverride");

const workspacesToClean = new Set();

before(async () => {
  await initDatabase();
});

afterEach(async () => {
  for (const workspaceId of workspacesToClean) {
    const releases = await queryAll("SELECT id FROM releases WHERE workspace_id = $1", [workspaceId]);
    for (const release of releases) {
      await run("DELETE FROM outbound_effect_outbox WHERE release_id = $1", [release.id]);
      await run("DELETE FROM override_history WHERE release_id = $1", [release.id]);
      await run("DELETE FROM overrides WHERE release_id = $1", [release.id]);
      await run("DELETE FROM release_intelligence WHERE release_id = $1", [release.id]);
    }
    await run("DELETE FROM releases WHERE workspace_id = $1", [workspaceId]);
  }
  workspacesToClean.clear();
});

async function seedRelease({ withVerdictTimestamp = false } = {}) {
  const workspaceId = `ws_override_outbox_${crypto.randomBytes(4).toString("hex")}`;
  const releaseId = `rel_override_outbox_${crypto.randomBytes(5).toString("hex")}`;
  const timestamp = nowIso();
  workspacesToClean.add(workspaceId);
  await ensureWorkspaceSeeded(workspaceId);
  await run(
    `INSERT INTO releases
       (id, workspace_id, version, release_type, environment, status, created_at, updated_at,
        verdict_issued_at)
     VALUES ($1, $2, 'override-outbox-v1', 'model_update', 'staging', 'UNCERTIFIED', $3, $3,
             $4::timestamptz)`,
    [releaseId, workspaceId, timestamp, withVerdictTimestamp ? timestamp : null]
  );
  const failedSignals = [{ signal_id: "accuracy", failure_kind: "threshold", value: 60 }];
  await upsertReleaseIntelligence(releaseId, workspaceId, {
    verdict: { failed_signals: failedSignals }
  });
  return {
    workspaceId,
    releaseId,
    failedSignals,
    release: await queryOne("SELECT * FROM releases WHERE id = $1", [releaseId])
  };
}

function overridePayload() {
  return {
    approver_name: "VP Engineering",
    approver_role: "VP_ENGINEERING",
    justification:
      "The team accepts the measured accuracy risk for this controlled rollout; the platform owner will monitor alerts and rollback if the metric degrades.",
    metadata: {
      impact_summary: "Limited staging rollout with no production customer traffic.",
      mitigation_plan: "Platform owner monitors alerts and rolls back within one hour.",
      follow_up_due_date: "2026-08-18"
    }
  };
}

describe("override outbound effect intents", () => {
  it("commits only the delivery intents that the override path actually executes", async () => {
    const seeded = await seedRelease();
    const result = await applyReleaseOverride(seeded.release, overridePayload(), {
      skipSideEffects: true
    });
    assert.equal(result.ok, true);

    const updatedRelease = await queryOne(
      "SELECT status, verdict_issued_at FROM releases WHERE id = $1",
      [seeded.releaseId]
    );
    assert.equal(updatedRelease.status, "CERTIFIED_WITH_OVERRIDE");
    assert.ok(updatedRelease.verdict_issued_at);

    const rows = await queryAll(
      `SELECT effect_type, source, verdict_status, verdict_issued_at, envelope_json
         FROM outbound_effect_outbox
        WHERE release_id = $1
        ORDER BY effect_type`,
      [seeded.releaseId]
    );
    assert.deepEqual(
      rows.map((row) => row.effect_type),
      [...OVERRIDE_EFFECT_TYPES].sort()
    );
    for (const row of rows) {
      assert.equal(row.source, "override");
      assert.equal(row.verdict_status, "CERTIFIED_WITH_OVERRIDE");
      assert.equal(row.envelope_json.trigger_source, "human_override");
      assert.deepEqual(row.envelope_json.failed_signals, seeded.failedSignals);
      assert.equal(
        new Date(row.verdict_issued_at).toISOString(),
        new Date(updatedRelease.verdict_issued_at).toISOString()
      );
    }
  });

  it("rolls override state and delivery intents back together", async () => {
    const seeded = await seedRelease({ withVerdictTimestamp: true });
    await assert.rejects(
      transaction(async (tx) => {
        const result = await applyReleaseOverride(seeded.release, overridePayload(), {
          tx,
          skipSideEffects: true
        });
        assert.equal(result.ok, true);
        throw new Error("rollback override transaction");
      }),
      /rollback override transaction/
    );

    const release = await queryOne("SELECT status FROM releases WHERE id = $1", [
      seeded.releaseId
    ]);
    assert.equal(release.status, "UNCERTIFIED");
    const outboxRows = await queryAll(
      "SELECT id FROM outbound_effect_outbox WHERE release_id = $1",
      [seeded.releaseId]
    );
    assert.equal(outboxRows.length, 0);
  });
});
