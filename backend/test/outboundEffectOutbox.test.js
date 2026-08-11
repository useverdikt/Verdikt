"use strict";

process.env.NODE_ENV = "test";
process.env.OUTBOX_MODE = "shadow";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "postgresql://127.0.0.1:5432/verdikt_test";
process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
process.env.WEBHOOK_SECRET = "test-webhook-secret-24-char-min";

const crypto = require("crypto");
const { before, describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { initDatabase, queryAll, run, transaction } = require("../src/database");
const { ensureWorkspaceSeeded, evaluateReleaseAfterSignalIngest } = require("../src/services/domain");
const {
  POST_VERDICT_EFFECT_TYPES,
  buildOutboxIdempotencyKey,
  enqueuePostVerdictOutbox
} = require("../src/services/outboundEffectOutbox");
const { nowIso } = require("../src/lib/time");

before(async () => {
  await initDatabase();
});

async function seedDueRelease() {
  const workspaceId = `ws_outbox_${crypto.randomBytes(4).toString("hex")}`;
  const releaseId = `rel_outbox_${crypto.randomBytes(5).toString("hex")}`;
  const timestamp = nowIso();
  await ensureWorkspaceSeeded(workspaceId);
  await run(
    `INSERT INTO releases
       (id, workspace_id, version, release_type, environment, status, created_at, updated_at, collection_deadline)
     VALUES ($1, $2, 'outbox-v1', 'model_update', 'staging', 'COLLECTING', $3, $3, NOW() - INTERVAL '1 minute')`,
    [releaseId, workspaceId, timestamp]
  );
  return { workspaceId, releaseId, timestamp };
}

describe("post-verdict outbound effect outbox", () => {
  it("builds stable event-scoped idempotency keys", () => {
    const input = {
      releaseId: "rel_123",
      effectType: "slack_verdict",
      verdictStatus: "UNCERTIFIED",
      verdictIssuedAt: "2026-08-11T12:00:00.000Z"
    };
    assert.equal(buildOutboxIdempotencyKey(input), buildOutboxIdempotencyKey(input));
    assert.notEqual(
      buildOutboxIdempotencyKey(input),
      buildOutboxIdempotencyKey({ ...input, effectType: "release_callback" })
    );
  });

  it("rolls back delivery intents with the surrounding verdict transaction", async () => {
    const { workspaceId, releaseId, timestamp } = await seedDueRelease();

    await assert.rejects(
      transaction(async (tx) => {
        await enqueuePostVerdictOutbox({
          tx,
          releaseId,
          workspaceId,
          verdictStatus: "UNCERTIFIED",
          verdictIssuedAt: timestamp,
          triggerSource: "rollback_test",
          failedSignals: [{ signal_id: "accuracy", failure_kind: "threshold" }]
        });
        throw new Error("rollback after outbox insert");
      }),
      /rollback after outbox insert/
    );

    const rows = await queryAll("SELECT id FROM outbound_effect_outbox WHERE release_id = $1", [releaseId]);
    assert.equal(rows.length, 0);
  });

  it("records one deduplicated intent per delivery channel when a verdict commits", async () => {
    const { workspaceId, releaseId } = await seedDueRelease();
    const release = (
      await queryAll("SELECT * FROM releases WHERE id = $1 AND workspace_id = $2", [
        releaseId,
        workspaceId
      ])
    )[0];

    const first = await evaluateReleaseAfterSignalIngest(release, releaseId, "outbox_test", 0);
    assert.equal(first.status, "UNCERTIFIED");

    // A repeated evaluation of the same terminal event must not create another
    // set of delivery intents.
    await evaluateReleaseAfterSignalIngest(release, releaseId, "outbox_test", 0);

    const rows = await queryAll(
      `SELECT effect_type, state, source, verdict_status, envelope_json
         FROM outbound_effect_outbox
        WHERE release_id = $1
        ORDER BY effect_type`,
      [releaseId]
    );
    assert.deepEqual(
      rows.map((row) => row.effect_type),
      [...POST_VERDICT_EFFECT_TYPES].sort()
    );
    assert.equal(rows.length, 4);
    for (const row of rows) {
      assert.equal(row.state, "pending");
      assert.equal(row.source, "verdict");
      assert.equal(row.verdict_status, "UNCERTIFIED");
      assert.equal(row.envelope_json.trigger_source, "outbox_test");
      assert.ok(Array.isArray(row.envelope_json.failed_signals));
    }
  });

  it("supports an immediate recording rollback through off mode", async () => {
    const result = await enqueuePostVerdictOutbox({
      mode: "off",
      tx: null,
      releaseId: "rel_off",
      workspaceId: "ws_off",
      verdictStatus: "UNCERTIFIED",
      verdictIssuedAt: nowIso()
    });
    assert.deepEqual(result, {
      mode: "off",
      attempted: 0,
      inserted: [],
      duplicate_count: 0
    });
  });
});
