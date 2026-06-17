"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { buildReleaseCallbackPayload } = require("../src/services/releaseCallback");

describe("buildReleaseCallbackPayload gate.can_merge", () => {
  const base = { id: "rel_1", workspace_id: "ws_1", version: "v1", verdict_issued_at: "2026-06-17T12:00:00.000Z" };

  it("can_merge true for CERTIFIED", () => {
    const payload = buildReleaseCallbackPayload({ ...base, status: "CERTIFIED" }, null);
    assert.equal(payload.gate.can_merge, true);
    assert.equal(payload.gate.certified, true);
  });

  it("can_merge true for CERTIFIED_WITH_OVERRIDE (matches default check_gate)", () => {
    const payload = buildReleaseCallbackPayload({ ...base, status: "CERTIFIED_WITH_OVERRIDE" }, null);
    assert.equal(payload.gate.can_merge, true);
    assert.equal(payload.gate.certified, true);
  });

  it("can_merge false for UNCERTIFIED", () => {
    const payload = buildReleaseCallbackPayload(
      { ...base, status: "UNCERTIFIED" },
      { failed_signals: [{ signal_id: "accuracy" }] }
    );
    assert.equal(payload.gate.can_merge, false);
    assert.equal(payload.gate.certified, false);
    assert.deepEqual(payload.gate.blocking_signals, ["accuracy"]);
  });
});
