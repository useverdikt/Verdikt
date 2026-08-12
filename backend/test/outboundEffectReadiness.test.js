"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  EFFECT_TYPES,
  boundedWindowDays,
  getOutboundEffectReadiness
} = require("../src/services/outboundEffectReadiness");
const { authMiddleware, requireHumanSession, requireWorkspaceMatch } = require("../src/routes/deps");
const registerOutboundEffectRoutes = require("../src/routes/workspaces/outboundEffects");

function aggregate(overrides = {}) {
  return {
    effect_type: "release_callback",
    total: 20,
    matched: 20,
    mismatched: 0,
    skipped: 0,
    unverifiable: 0,
    retrying: 0,
    backlog: 0,
    stale_backlog: 0,
    dead_letters: 0,
    failed_legacy_deliveries: 0,
    observation_expected: 20,
    observation_recorded: 20,
    p95_comparison_seconds: "12.25",
    ...overrides
  };
}

describe("outbound effect readiness", () => {
  it("reports ready only when the evidence sample clears every gate", async () => {
    let queryArgs = null;
    const result = await getOutboundEffectReadiness("ws_ready", {
      windowDays: 7,
      queryAllFn: async (_sql, args) => {
        queryArgs = args;
        return [aggregate()];
      },
      now: new Date("2026-08-12T00:00:00.000Z")
    });

    assert.deepEqual(queryArgs, ["ws_ready", 7, 300]);
    assert.equal(result.status, "ready");
    assert.equal(result.ready, true);
    assert.equal(result.generated_at, "2026-08-12T00:00:00.000Z");
    assert.deepEqual(
      result.effects.map((effect) => effect.effect_type),
      EFFECT_TYPES
    );
    const callback = result.effects.find((effect) => effect.effect_type === "release_callback");
    assert.equal(callback.observation_coverage_pct, 100);
    assert.equal(callback.p95_comparison_seconds, 12.25);
  });

  it("blocks on any mismatch even before the minimum sample size", async () => {
    const result = await getOutboundEffectReadiness("ws_blocked", {
      queryAllFn: async () => [
        aggregate({
          total: 3,
          matched: 2,
          mismatched: 1,
          observation_expected: 3,
          observation_recorded: 3
        })
      ]
    });

    assert.equal(result.status, "blocked");
    assert.deepEqual(result.blockers, ["release_callback:shadow_mismatch"]);
  });

  it("blocks readiness when legacy delivery evidence contains a non-2xx result", async () => {
    const result = await getOutboundEffectReadiness("ws_failed_delivery", {
      queryAllFn: async () => [aggregate({ failed_legacy_deliveries: 1 })]
    });

    assert.equal(result.status, "blocked");
    assert.deepEqual(result.blockers, ["release_callback:legacy_delivery_failed"]);
    const callback = result.effects.find((effect) => effect.effect_type === "release_callback");
    assert.equal(callback.failed_legacy_deliveries, 1);
  });

  it("reports insufficient data for clean but undersized evidence", async () => {
    const result = await getOutboundEffectReadiness("ws_small", {
      queryAllFn: async () => [
        aggregate({
          total: 19,
          matched: 19,
          observation_expected: 19,
          observation_recorded: 19
        })
      ]
    });

    assert.equal(result.status, "insufficient_data");
    assert.equal(result.ready, false);
  });

  it("blocks observation gaps, stale work, dead letters, and slow comparison", async () => {
    const result = await getOutboundEffectReadiness("ws_unhealthy", {
      queryAllFn: async () => [
        aggregate({
          observation_recorded: 18,
          stale_backlog: 1,
          dead_letters: 1,
          p95_comparison_seconds: 301
        })
      ]
    });

    assert.equal(result.status, "blocked");
    assert.deepEqual(result.blockers, [
      "release_callback:dead_letter",
      "release_callback:stale_backlog",
      "release_callback:observation_coverage",
      "release_callback:comparison_latency"
    ]);
  });

  it("bounds the requested reporting window", () => {
    assert.equal(boundedWindowDays("0"), 1);
    assert.equal(boundedWindowDays("14"), 14);
    assert.equal(boundedWindowDays("999"), 30);
    assert.equal(boundedWindowDays("invalid"), 7);
  });

  it("protects the readiness endpoint with human workspace authentication", () => {
    let registration = null;
    registerOutboundEffectRoutes({
      get: (...args) => {
        registration = args;
      }
    });

    assert.equal(
      registration[0],
      "/api/workspaces/:workspaceId/outbound-effects/readiness"
    );
    assert.equal(registration[1], authMiddleware);
    assert.equal(registration[2], requireHumanSession);
    assert.equal(registration[3], requireWorkspaceMatch);
    assert.equal(typeof registration[4], "function");
  });
});
