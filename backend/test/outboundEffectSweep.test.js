"use strict";

process.env.NODE_ENV = "test";
process.env.OUTBOX_MODE = "shadow";
process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
process.env.WEBHOOK_SECRET = "test-webhook-secret-24-char-min";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  runOutboundEffectShadowSweepOnce,
  getOutboundEffectSweepHealth
} = require("../src/jobs/outboundEffectSweep");
const { buildHealthResponse } = require("../src/worker");

describe("outbound effect shadow sweep job", () => {
  it("does no work when outbox recording is off", async () => {
    let calls = 0;
    const result = await runOutboundEffectShadowSweepOnce({
      mode: "off",
      processFn: async () => {
        calls += 1;
      }
    });
    assert.deepEqual(result, { disabled: true, mode: "off" });
    assert.equal(calls, 0);
  });

  it("runs shadow processing and emits a bounded batch summary", async () => {
    const events = [];
    const times = [
      new Date("2026-08-12T00:00:00.000Z"),
      new Date("2026-08-12T00:00:01.000Z")
    ];
    const result = await runOutboundEffectShadowSweepOnce({
      mode: "shadow",
      processFn: async ({ limit, workerId, leaseMs, maxAttempts }) => {
        assert.ok(limit > 0);
        assert.ok(workerId);
        assert.ok(leaseMs >= 1_000);
        assert.ok(maxAttempts > 0);
        return {
          claimed: 1,
          matched: 1,
          mismatched: 0,
          skipped: 0,
          unverifiable: 0,
          retried: 0,
          dead_lettered: 0
        };
      },
      logFn: (_level, event) => events.push(event),
      incFn: () => {},
      nowFn: () => times.shift()
    });
    assert.equal(result.matched, 1);
    assert.deepEqual(events, ["outbox_shadow_sweep_complete"]);
    assert.deepEqual(getOutboundEffectSweepHealth(), {
      mode: "shadow",
      enabled: true,
      last_attempted_at: "2026-08-12T00:00:00.000Z",
      last_succeeded_at: "2026-08-12T00:00:01.000Z",
      last_failed_at: null,
      consecutive_failures: 0,
      last_summary: {
        claimed: 1,
        mismatched: 0,
        retried: 0,
        dead_lettered: 0
      }
    });
  });

  it("records failed sweeps without exposing raw errors in worker health", async () => {
    const result = await runOutboundEffectShadowSweepOnce({
      mode: "shadow",
      processFn: async () => {
        throw new Error("database password secret");
      },
      logFn: () => {},
      incFn: () => {},
      nowFn: () => new Date("2026-08-12T00:00:02.000Z")
    });

    assert.equal(result, null);
    const health = getOutboundEffectSweepHealth();
    assert.equal(health.last_failed_at, "2026-08-12T00:00:02.000Z");
    assert.equal(health.consecutive_failures, 1);
    assert.doesNotMatch(JSON.stringify(health), /database password secret/);

    const body = JSON.parse(buildHealthResponse(true, { database: true, jobs_started: true }));
    assert.equal(body.checks.outbox_shadow.last_failed_at, "2026-08-12T00:00:02.000Z");
    assert.equal(body.checks.outbox_shadow.consecutive_failures, 1);
  });
});
