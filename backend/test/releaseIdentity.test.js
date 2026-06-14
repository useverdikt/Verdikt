"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  COLLECTION_GRACE_MS,
  computeCollectionAgeMs,
  computeGateAction
} = require("../src/services/releaseIdentity");

describe("computeGateAction", () => {
  it("returns merge when gate is allowed and certified", () => {
    assert.equal(
      computeGateAction({ status: "CERTIFIED", gateAllowed: true, blockingSignals: [], missingRequiredSignals: [] }),
      "merge"
    );
  });

  it("returns collecting during grace period for COLLECTING releases", () => {
    assert.equal(
      computeGateAction({
        status: "COLLECTING",
        gateAllowed: false,
        blockingSignals: [],
        missingRequiredSignals: ["accuracy"],
        collectionAgeMs: 5_000
      }),
      "collecting"
    );
  });

  it("returns self_heal after grace period for COLLECTING releases", () => {
    assert.equal(
      computeGateAction({
        status: "COLLECTING",
        gateAllowed: false,
        blockingSignals: [],
        missingRequiredSignals: ["accuracy"],
        collectionAgeMs: COLLECTION_GRACE_MS
      }),
      "self_heal"
    );
  });

  it("returns escalate for UNCERTIFIED with blocking signals", () => {
    assert.equal(
      computeGateAction({
        status: "UNCERTIFIED",
        gateAllowed: false,
        blockingSignals: ["accuracy"],
        missingRequiredSignals: []
      }),
      "escalate"
    );
  });
});

describe("computeCollectionAgeMs", () => {
  it("returns age in ms from release created_at", () => {
    const now = Date.parse("2026-06-14T12:01:00.000Z");
    const age = computeCollectionAgeMs(
      { created_at: "2026-06-14T12:00:30.000Z" },
      now
    );
    assert.equal(age, 30_000);
  });
});
