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

const { initDatabase, queryOne, queryAll, run, transaction } = require("../src/database");
const { ensureWorkspaceSeeded } = require("../src/services/workspaceConfig");
const { enqueuePostVerdictOutbox } = require("../src/services/outboundEffectOutbox");
const {
  canonicalHash,
  claimDueOutboundEffects,
  processDueOutboundEffects
} = require("../src/services/outboundEffectShadowWorker");
const { nowIso } = require("../src/lib/time");

const workspacesToClean = new Set();

before(async () => {
  await initDatabase();
});

afterEach(async () => {
  for (const workspaceId of workspacesToClean) {
    await run("DELETE FROM outbound_effect_outbox WHERE workspace_id = $1", [workspaceId]);
    await run("DELETE FROM releases WHERE workspace_id = $1", [workspaceId]);
  }
  workspacesToClean.clear();
});

async function seedRelease({ callbackUrl = null } = {}) {
  const workspaceId = `ws_shadow_${crypto.randomBytes(4).toString("hex")}`;
  const releaseId = `rel_shadow_${crypto.randomBytes(5).toString("hex")}`;
  const timestamp = nowIso();
  workspacesToClean.add(workspaceId);
  await ensureWorkspaceSeeded(workspaceId);
  await run(
    `INSERT INTO releases
       (id, workspace_id, version, release_type, environment, status, created_at, updated_at,
        verdict_issued_at, callback_url, commit_sha, pr_number)
     VALUES ($1, $2, 'shadow-v1', 'model_update', 'staging', 'UNCERTIFIED', $3, $3,
             $3, $4, $5, 77)`,
    [releaseId, workspaceId, timestamp, callbackUrl, crypto.randomBytes(20).toString("hex")]
  );
  return { workspaceId, releaseId, timestamp };
}

async function enqueueEffects(release, effectTypes, failedSignals = []) {
  return transaction((tx) =>
    enqueuePostVerdictOutbox({
      tx,
      releaseId: release.releaseId,
      workspaceId: release.workspaceId,
      verdictStatus: "UNCERTIFIED",
      verdictIssuedAt: release.timestamp,
      triggerSource: "shadow_worker_test",
      failedSignals,
      effectTypes
    })
  );
}

async function configureWebhook(release) {
  await run(
    `INSERT INTO outbound_webhooks
       (id, workspace_id, url, secret, events, enabled, created_at, updated_at)
     VALUES ($1, $2, 'https://example.com/hook', NULL, 'UNCERTIFIED', 1, $3, $3)
     ON CONFLICT (workspace_id) DO UPDATE SET
       events = EXCLUDED.events,
       enabled = 1,
       updated_at = EXCLUDED.updated_at`,
    [`owh_${release.workspaceId}`, release.workspaceId, nowIso()]
  );
}

async function insertWebhookDelivery(release, failedSignals, overrides = {}) {
  const payload = {
    event: "UNCERTIFIED",
    release_id: release.releaseId,
    workspace_id: release.workspaceId,
    status: "UNCERTIFIED",
    verdict_issued_at: release.timestamp,
    failed_signals: failedSignals,
    sent_at: nowIso(),
    ...overrides
  };
  await run(
    `INSERT INTO outbound_webhook_deliveries
       (webhook_id, release_id, event_type, payload_json, response_status, error_message, delivered_at)
     VALUES ($1, $2, 'UNCERTIFIED', $3, 200, NULL, $4)`,
    [`owh_${release.workspaceId}`, release.releaseId, JSON.stringify(payload), nowIso()]
  );
}

describe("outbound effect shadow worker", () => {
  it("hashes equivalent objects independently of object key order", () => {
    assert.equal(canonicalHash({ b: 2, a: { y: 2, x: 1 } }), canonicalHash({ a: { x: 1, y: 2 }, b: 2 }));
  });

  it("partitions claims across workers and recovers expired leases", async () => {
    const release = await seedRelease();
    await enqueueEffects(release, [
      "vcs_writeback",
      "outbound_webhook",
      "release_callback",
      "slack_verdict"
    ]);

    const [workerA, workerB] = await Promise.all([
      claimDueOutboundEffects({
        limit: 2,
        workerId: "shadow-worker-a",
        workspaceId: release.workspaceId,
        leaseMs: 60_000
      }),
      claimDueOutboundEffects({
        limit: 2,
        workerId: "shadow-worker-b",
        workspaceId: release.workspaceId,
        leaseMs: 60_000
      })
    ]);
    const idsA = new Set(workerA.map((row) => row.id));
    const idsB = new Set(workerB.map((row) => row.id));
    assert.equal(idsA.size, 2);
    assert.equal(idsB.size, 2);
    assert.equal([...idsA].some((id) => idsB.has(id)), false);
    assert.equal(new Set([...idsA, ...idsB]).size, 4);

    const unavailable = await claimDueOutboundEffects({
      limit: 4,
      workerId: "shadow-worker-c",
      workspaceId: release.workspaceId
    });
    assert.equal(unavailable.length, 0);

    const expiredId = [...idsA, ...idsB][0];
    await run(
      `UPDATE outbound_effect_outbox
          SET claimed_until = NOW() - INTERVAL '1 second'
        WHERE id = $1`,
      [expiredId]
    );
    const recovered = await claimDueOutboundEffects({
      limit: 1,
      workerId: "shadow-worker-c",
      workspaceId: release.workspaceId
    });
    assert.equal(recovered[0].id, expiredId);
    assert.equal(Number(recovered[0].attempt_count), 2);
  });

  it("matches observable webhook intent without making an external request", async () => {
    const release = await seedRelease();
    const failedSignals = [{ signal_id: "accuracy", failure_kind: "threshold", value: 60 }];
    await configureWebhook(release);
    await enqueueEffects(release, ["outbound_webhook"], failedSignals);
    await insertWebhookDelivery(release, failedSignals);
    await run("UPDATE outbound_webhooks SET enabled = 0 WHERE workspace_id = $1", [
      release.workspaceId
    ]);

    let fetchCalls = 0;
    const originalFetch = global.fetch;
    global.fetch = async () => {
      fetchCalls += 1;
      throw new Error("shadow worker must not send");
    };
    try {
      const result = await processDueOutboundEffects({
        workerId: "shadow-match-worker",
        workspaceId: release.workspaceId
      });
      assert.equal(result.matched, 1);
    } finally {
      global.fetch = originalFetch;
    }

    assert.equal(fetchCalls, 0);
    const row = await queryOne(
      `SELECT state, payload_hash, shadow_result_json
         FROM outbound_effect_outbox
        WHERE release_id = $1`,
      [release.releaseId]
    );
    assert.equal(row.state, "shadow_matched");
    assert.ok(row.payload_hash);
    assert.equal(row.shadow_result_json.outcome, "matched");
  });

  it("surfaces mismatches and retries configured channels until legacy evidence arrives", async () => {
    const release = await seedRelease({ callbackUrl: "https://example.com/callback" });
    await configureWebhook(release);
    await run(
      "UPDATE workspace_policies SET slack_webhook_url = $1 WHERE workspace_id = $2",
      ["https://hooks.slack.com/services/T/B/X", release.workspaceId]
    );
    await enqueueEffects(release, ["outbound_webhook", "release_callback", "slack_verdict"]);
    await insertWebhookDelivery(release, [], { status: "CERTIFIED" });

    const result = await processDueOutboundEffects({
      workerId: "shadow-mismatch-worker",
      workspaceId: release.workspaceId
    });
    assert.equal(result.mismatched, 1);
    assert.equal(result.retried, 2);

    const rows = await queryAll(
      `SELECT effect_type, state
         FROM outbound_effect_outbox
        WHERE release_id = $1
        ORDER BY effect_type`,
      [release.releaseId]
    );
    assert.deepEqual(rows, [
      { effect_type: "outbound_webhook", state: "shadow_mismatch" },
      { effect_type: "release_callback", state: "retry" },
      { effect_type: "slack_verdict", state: "retry" }
    ]);
  });

  it("retries missing legacy evidence and dead-letters after the bounded attempt count", async () => {
    const release = await seedRelease();
    await configureWebhook(release);
    await enqueueEffects(release, ["outbound_webhook"]);

    const first = await processDueOutboundEffects({
      workerId: "shadow-retry-worker",
      workspaceId: release.workspaceId,
      maxAttempts: 2
    });
    assert.equal(first.retried, 1);

    await run(
      `UPDATE outbound_effect_outbox
          SET next_attempt_at = NOW() - INTERVAL '1 second'
        WHERE release_id = $1`,
      [release.releaseId]
    );
    const second = await processDueOutboundEffects({
      workerId: "shadow-retry-worker",
      workspaceId: release.workspaceId,
      maxAttempts: 2
    });
    assert.equal(second.dead_lettered, 1);

    const row = await queryOne(
      `SELECT state, attempt_count, last_error
         FROM outbound_effect_outbox
        WHERE release_id = $1`,
      [release.releaseId]
    );
    assert.equal(row.state, "dead_letter");
    assert.equal(Number(row.attempt_count), 2);
    assert.match(row.last_error, /not observed/);

    const audit = await queryOne(
      `SELECT event_type
         FROM audit_events
        WHERE release_id = $1 AND event_type = 'OUTBOUND_EFFECT_SHADOW_EXHAUSTED'
        ORDER BY id DESC LIMIT 1`,
      [release.releaseId]
    );
    assert.equal(audit.event_type, "OUTBOUND_EFFECT_SHADOW_EXHAUSTED");
  });
});
