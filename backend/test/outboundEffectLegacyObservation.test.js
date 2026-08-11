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

const { initDatabase, queryAll, run, transaction } = require("../src/database");
const { nowIso } = require("../src/lib/time");
const { ensureWorkspaceSeeded } = require("../src/services/workspaceConfig");
const { enqueuePostVerdictOutbox } = require("../src/services/outboundEffectOutbox");
const {
  recordLegacyEffectObservation
} = require("../src/services/outboundEffectLegacyObservation");
const {
  processDueOutboundEffects
} = require("../src/services/outboundEffectShadowWorker");
const { deliverReleaseCallback } = require("../src/services/releaseCallback");
const { deliverSlackVerdict } = require("../src/services/slackNotifier");

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

async function seedObservedRelease() {
  const workspaceId = `ws_observation_${crypto.randomBytes(4).toString("hex")}`;
  const releaseId = `rel_observation_${crypto.randomBytes(5).toString("hex")}`;
  const timestamp = nowIso();
  workspacesToClean.add(workspaceId);
  await ensureWorkspaceSeeded(workspaceId);
  await run(
    `INSERT INTO releases
       (id, workspace_id, version, release_type, environment, status, created_at, updated_at,
        verdict_issued_at, callback_url)
     VALUES ($1, $2, 'observation-v1', 'model_update', 'staging', 'UNCERTIFIED', $3, $3,
             $3, 'http://127.0.0.1/callback')`,
    [releaseId, workspaceId, timestamp]
  );
  await run(
    "UPDATE workspace_policies SET slack_webhook_url = $1 WHERE workspace_id = $2",
    ["https://example.com/services/T/B/X", workspaceId]
  );
  const release = {
    id: releaseId,
    workspace_id: workspaceId,
    version: "observation-v1",
    release_type: "model_update",
    environment: "staging",
    status: "UNCERTIFIED",
    verdict_issued_at: timestamp,
    callback_url: "http://127.0.0.1/callback"
  };
  return { workspaceId, releaseId, timestamp, release };
}

describe("legacy outbound effect observations", () => {
  it("records Slack and callback attempts and lets shadow processing compare them without sending", async () => {
    const seeded = await seedObservedRelease();
    const failedSignals = [{ signal_id: "accuracy", failure_kind: "threshold", value: 60 }];
    await transaction((tx) =>
      enqueuePostVerdictOutbox({
        tx,
        releaseId: seeded.releaseId,
        workspaceId: seeded.workspaceId,
        verdictStatus: "UNCERTIFIED",
        verdictIssuedAt: seeded.timestamp,
        triggerSource: "legacy_observation_test",
        failedSignals,
        effectTypes: ["release_callback", "slack_verdict"]
      })
    );

    let fetchCalls = 0;
    const originalFetch = global.fetch;
    global.fetch = async () => {
      fetchCalls += 1;
      throw new Error("invalid URLs should be blocked before fetch");
    };
    try {
      const callbackResult = await deliverReleaseCallback(
        seeded.release,
        null,
        {},
        failedSignals,
        null
      );
      assert.equal(callbackResult.delivered, false);
      await deliverSlackVerdict(seeded.release, failedSignals, null);

      const beforeProcessing = await queryAll(
        `SELECT effect_type, legacy_comparison_json, legacy_comparison_hash,
                legacy_observed_at, legacy_response_status, legacy_error_code
           FROM outbound_effect_outbox
          WHERE release_id = $1
          ORDER BY effect_type`,
        [seeded.releaseId]
      );
      assert.equal(beforeProcessing.length, 2);
      for (const row of beforeProcessing) {
        const observation = row.legacy_comparison_json;
        assert.equal(observation.outcome, "blocked");
        assert.equal(row.legacy_error_code, "invalid_url");
        assert.equal(observation.input.release_id, seeded.releaseId);
        assert.match(observation.input_hash, /^[a-f0-9]{64}$/);
        assert.equal(row.legacy_comparison_hash, observation.input_hash);
        assert.match(observation.payload_hash, /^[a-f0-9]{64}$/);
        assert.ok(row.legacy_observed_at);
        assert.equal(JSON.stringify(observation).includes("127.0.0.1"), false);
        assert.equal(JSON.stringify(observation).includes("example.com"), false);
      }

      const result = await processDueOutboundEffects({
        workerId: "legacy-observation-worker",
        workspaceId: seeded.workspaceId
      });
      assert.equal(result.matched, 2);
      assert.equal(result.retried, 0);
    } finally {
      global.fetch = originalFetch;
    }

    assert.equal(fetchCalls, 0);
    const completed = await queryAll(
      `SELECT effect_type, state, shadow_result_json, legacy_comparison_json
         FROM outbound_effect_outbox
        WHERE release_id = $1
        ORDER BY effect_type`,
      [seeded.releaseId]
    );
    for (const row of completed) {
      assert.equal(row.state, "shadow_matched");
      assert.equal(row.shadow_result_json.outcome, "matched");
      assert.equal(row.shadow_result_json.comparison_scope, "delivery_input");
      assert.equal(row.legacy_comparison_json.outcome, "blocked");
    }
  });

  it("never changes delivery behavior when observation persistence fails", async () => {
    const seeded = await seedObservedRelease();
    const result = await recordLegacyEffectObservation({
      release: seeded.release,
      effectType: "slack_verdict",
      payload: { text: "test" },
      outcome: "succeeded",
      runFn: async () => {
        throw new Error("database unavailable");
      },
      logFn: () => {},
      incFn: () => {}
    });
    assert.equal(result.recorded, false);
    assert.match(result.error, /database unavailable/);

    let disabledWrites = 0;
    const disabled = await recordLegacyEffectObservation({
      release: seeded.release,
      effectType: "slack_verdict",
      outcome: "succeeded",
      mode: "off",
      runFn: async () => {
        disabledWrites += 1;
      }
    });
    assert.equal(disabled.reason, "outbox_disabled");
    assert.equal(disabledWrites, 0);
  });

  it("atomically requeues terminal rows and keeps the first observation", async () => {
    const seeded = await seedObservedRelease();
    await transaction((tx) =>
      enqueuePostVerdictOutbox({
        tx,
        releaseId: seeded.releaseId,
        workspaceId: seeded.workspaceId,
        verdictStatus: "UNCERTIFIED",
        verdictIssuedAt: seeded.timestamp,
        triggerSource: "late_observation_test",
        effectTypes: ["release_callback"]
      })
    );
    await run(
      `UPDATE outbound_effect_outbox
          SET state = 'shadow_unverifiable',
              last_error = 'legacy observation unavailable'
        WHERE release_id = $1`,
      [seeded.releaseId]
    );

    const first = await recordLegacyEffectObservation({
      release: seeded.release,
      effectType: "release_callback",
      payload: { event: "verdikt.verdict" },
      outcome: "failed",
      errorCode: "http_503",
      responseStatus: 503
    });
    const duplicate = await recordLegacyEffectObservation({
      release: seeded.release,
      effectType: "release_callback",
      payload: { event: "different" },
      outcome: "succeeded",
      responseStatus: 200
    });
    assert.equal(first.recorded, true);
    assert.equal(duplicate.recorded, false);

    const [row] = await queryAll(
      `SELECT state, last_error, legacy_comparison_json, legacy_response_status
         FROM outbound_effect_outbox
        WHERE release_id = $1`,
      [seeded.releaseId]
    );
    assert.equal(row.state, "pending");
    assert.equal(row.last_error, null);
    assert.equal(row.legacy_comparison_json.outcome, "failed");
    assert.equal(row.legacy_response_status, 503);
  });

  it("preserves an observation written after the worker has claimed the row", async () => {
    const seeded = await seedObservedRelease();
    await transaction((tx) =>
      enqueuePostVerdictOutbox({
        tx,
        releaseId: seeded.releaseId,
        workspaceId: seeded.workspaceId,
        verdictStatus: "UNCERTIFIED",
        verdictIssuedAt: seeded.timestamp,
        triggerSource: "observation_race_test",
        effectTypes: ["release_callback"]
      })
    );

    const result = await processDueOutboundEffects({
      workerId: "observation-race-worker",
      workspaceId: seeded.workspaceId,
      compareFn: async () => {
        await recordLegacyEffectObservation({
          release: seeded.release,
          effectType: "release_callback",
          payload: { event: "verdikt.verdict" },
          outcome: "succeeded",
          responseStatus: 200
        });
        return {
          outcome: "matched",
          expected: { release_id: seeded.releaseId },
          actual: { release_id: seeded.releaseId },
          expected_hash: "expected",
          actual_hash: "expected"
        };
      }
    });
    assert.equal(result.matched, 1);

    const [row] = await queryAll(
      `SELECT state, shadow_result_json, legacy_comparison_json
         FROM outbound_effect_outbox
        WHERE release_id = $1`,
      [seeded.releaseId]
    );
    assert.equal(row.state, "shadow_matched");
    assert.equal(row.shadow_result_json.outcome, "matched");
    assert.equal(row.legacy_comparison_json.outcome, "succeeded");
  });
});
