"use strict";

process.env.NODE_ENV = "test";
process.env.OUTBOX_MODE = "shadow";
process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
process.env.WEBHOOK_SECRET = "test-webhook-secret-24-char-min";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { runOutboundEffectShadowSweepOnce } = require("../src/jobs/outboundEffectSweep");

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
      incFn: () => {}
    });
    assert.equal(result.matched, 1);
    assert.deepEqual(events, ["outbox_shadow_sweep_complete"]);
  });
});
