"use strict";

process.env.NODE_ENV = "test";
process.env.OUTBOX_MODE = "off";
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "postgresql://127.0.0.1:5432/verdikt_test";
process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
process.env.WEBHOOK_SECRET = "test-webhook-secret-24-char-min";

const crypto = require("crypto");
const { before, describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { initDatabase, queryAll, queryOne, run } = require("../src/database");
const { nowIso } = require("../src/lib/time");
const { ensureWorkspaceSeeded } = require("../src/services/workspaceConfig");
const { isAllowedSignalValue } = require("../src/services/verdictEngine");
const {
  ingestReleaseSignals,
  ingestIntegrationSignals
} = require("../src/services/signalIngest");

before(async () => {
  await initDatabase();
});

async function seedRelease() {
  const workspaceId = `ws_unified_ingest_${crypto.randomBytes(4).toString("hex")}`;
  const releaseId = `rel_unified_ingest_${crypto.randomBytes(5).toString("hex")}`;
  const timestamp = nowIso();
  await ensureWorkspaceSeeded(workspaceId);
  await run(
    `INSERT INTO releases
       (id, workspace_id, version, release_type, environment, status, created_at, updated_at,
        collection_deadline)
     VALUES ($1, $2, 'unified-ingest-v1', 'model_update', 'staging', 'COLLECTING', $3, $3,
             NOW() + INTERVAL '10 minutes')`,
    [releaseId, workspaceId, timestamp]
  );
  return {
    workspaceId,
    releaseId,
    release: await queryOne("SELECT * FROM releases WHERE id = $1", [releaseId])
  };
}

describe("shared release signal ingestion", () => {
  it("persists valid values, reports rejected values, and evaluates once", async () => {
    const seeded = await seedRelease();
    const result = await ingestReleaseSignals({
      release: seeded.release,
      signals: { accuracy: 90, safety: 101 },
      source: "shared_ingest_test",
      idempotencyKey: `shared-${seeded.releaseId}`,
      validateSignal: isAllowedSignalValue
    });

    assert.equal(result.kind, "ingested");
    assert.equal(result.insertedCount, 1);
    assert.deepEqual(result.acceptedSignalIds, ["accuracy"]);
    assert.deepEqual(result.rejectedSignalIds, ["safety"]);

    const rows = await queryAll(
      "SELECT signal_id, value FROM signals WHERE release_id = $1 ORDER BY signal_id",
      [seeded.releaseId]
    );
    assert.deepEqual(rows, [{ signal_id: "accuracy", value: 90 }]);
  });

  it("replays duplicate keys without another evaluation or audit write", async () => {
    const seeded = await seedRelease();
    const idempotencyKey = `duplicate-${seeded.releaseId}`;
    const input = {
      release: seeded.release,
      signals: { accuracy: 90 },
      source: "shared_ingest_test",
      idempotencyKey,
      validateSignal: isAllowedSignalValue
    };
    await ingestReleaseSignals(input);
    const before = await queryOne(
      "SELECT COUNT(*) AS c FROM audit_events WHERE release_id = $1",
      [seeded.releaseId]
    );

    const duplicate = await ingestReleaseSignals(input);
    const after = await queryOne(
      "SELECT COUNT(*) AS c FROM audit_events WHERE release_id = $1",
      [seeded.releaseId]
    );
    assert.equal(duplicate.kind, "duplicate");
    assert.equal(duplicate.response.duplicate, true);
    assert.equal(Number(after.c), Number(before.c));
  });

  it("returns a typed validation result when every submitted value is invalid", async () => {
    const seeded = await seedRelease();
    const result = await ingestReleaseSignals({
      release: seeded.release,
      signals: { accuracy: -1, safety: 101 },
      source: "shared_ingest_test",
      validateSignal: isAllowedSignalValue
    });
    assert.equal(result.kind, "no_valid_signals");
    assert.deepEqual(result.rejectedSignalIds, ["accuracy", "safety"]);

    const count = await queryOne("SELECT COUNT(*) AS c FROM signals WHERE release_id = $1", [
      seeded.releaseId
    ]);
    assert.equal(Number(count.c), 0);
  });

  it("keeps integration audit and duplicate response contracts on the shared path", async () => {
    const seeded = await seedRelease();
    const idempotencyKey = `integration-${seeded.releaseId}`;
    const input = {
      release: seeded.release,
      mappedSignals: { accuracy: 91 },
      source: "integration:test",
      idempotencyKey,
      auditDetails: { provider: "test" }
    };
    const first = await ingestIntegrationSignals(input);
    const duplicate = await ingestIntegrationSignals(input);

    assert.equal(first.inserted_count, 1);
    assert.equal(duplicate.inserted_count, 0);
    assert.equal(duplicate.duplicate, true);
    const auditCount = await queryOne(
      `SELECT COUNT(*) AS c
         FROM audit_events
        WHERE release_id = $1
          AND event_type = 'INTEGRATION_SIGNALS_MAPPED'`,
      [seeded.releaseId]
    );
    assert.equal(Number(auditCount.c), 1);
  });
});
