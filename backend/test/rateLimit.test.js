"use strict";

const { test, describe, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const {
  checkSignalIngestRateLimit,
  checkGatePollRateLimit
} = require("../src/middleware/rateLimit");

describe("rate limiting for signal ingest and gate polling", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalSignalKeyLimit = process.env.SIGNAL_INGEST_RATE_LIMIT_PER_MINUTE_PER_KEY;
  const originalSignalWsLimit = process.env.SIGNAL_INGEST_RATE_LIMIT_PER_MINUTE_PER_WORKSPACE;
  const originalGateKeyLimit = process.env.GATE_RATE_LIMIT_PER_MINUTE_PER_KEY;
  const originalGateWsLimit = process.env.GATE_RATE_LIMIT_PER_MINUTE_PER_WORKSPACE;

  beforeEach(() => {
    // Lower limits so tests don't need hundreds of iterations.
    process.env.NODE_ENV = "production";
    process.env.SIGNAL_INGEST_RATE_LIMIT_PER_MINUTE_PER_KEY = "3";
    process.env.SIGNAL_INGEST_RATE_LIMIT_PER_MINUTE_PER_WORKSPACE = "5";
    process.env.GATE_RATE_LIMIT_PER_MINUTE_PER_KEY = "3";
    process.env.GATE_RATE_LIMIT_PER_MINUTE_PER_WORKSPACE = "5";
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    if (originalSignalKeyLimit === undefined) delete process.env.SIGNAL_INGEST_RATE_LIMIT_PER_MINUTE_PER_KEY;
    else process.env.SIGNAL_INGEST_RATE_LIMIT_PER_MINUTE_PER_KEY = originalSignalKeyLimit;
    if (originalSignalWsLimit === undefined) delete process.env.SIGNAL_INGEST_RATE_LIMIT_PER_MINUTE_PER_WORKSPACE;
    else process.env.SIGNAL_INGEST_RATE_LIMIT_PER_MINUTE_PER_WORKSPACE = originalSignalWsLimit;
    if (originalGateKeyLimit === undefined) delete process.env.GATE_RATE_LIMIT_PER_MINUTE_PER_KEY;
    else process.env.GATE_RATE_LIMIT_PER_MINUTE_PER_KEY = originalGateKeyLimit;
    if (originalGateWsLimit === undefined) delete process.env.GATE_RATE_LIMIT_PER_MINUTE_PER_WORKSPACE;
    else process.env.GATE_RATE_LIMIT_PER_MINUTE_PER_WORKSPACE = originalGateWsLimit;
  });

  test("signal ingest enforces per-key limit", async () => {
    let allowed = 0;
    let blocked = false;
    for (let i = 0; i < 5; i += 1) {
      const ok = await checkSignalIngestRateLimit("key_1", "ws_1");
      if (ok) allowed += 1;
      else blocked = true;
    }
    assert.equal(allowed, 3, "per-key limit should allow exactly 3");
    assert.equal(blocked, true, "4th+ request should be blocked");
  });

  test("gate poll enforces per-key limit", async () => {
    let allowed = 0;
    let blocked = false;
    for (let i = 0; i < 5; i += 1) {
      const ok = await checkGatePollRateLimit("key_1", "ws_1");
      if (ok) allowed += 1;
      else blocked = true;
    }
    assert.equal(allowed, 3);
    assert.equal(blocked, true);
  });

  test("signal ingest enforces per-workspace limit across keys", async () => {
    let allowed = 0;
    let blocked = false;
    for (let i = 0; i < 7; i += 1) {
      const ok = await checkSignalIngestRateLimit(`key_${i}`, "ws_shared");
      if (ok) allowed += 1;
      else blocked = true;
    }
    assert.equal(allowed, 5, "per-workspace limit should allow exactly 5");
    assert.equal(blocked, true, "6th+ request should be blocked");
  });

  test("rate limits are bypassed in test environment", async () => {
    process.env.NODE_ENV = "test";
    const ok = await checkSignalIngestRateLimit("key_1", "ws_1");
    assert.equal(ok, true);
  });
});
