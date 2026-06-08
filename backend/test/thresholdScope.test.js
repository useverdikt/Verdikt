"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const sharedPkg = require("../src/lib/sharedPkg");
const { isSignalRequiredForRelease } = require("../src/services/signalScope");

describe("threshold bounds", () => {
  it("valueToThresholdBounds uses max for crashrate", () => {
    assert.deepEqual(sharedPkg.valueToThresholdBounds("crashrate", 0.1), { min: null, max: 0.1 });
    assert.deepEqual(sharedPkg.valueToThresholdBounds("smoke", 100), { min: 100, max: null });
  });

  it("normalizeThresholdBounds repairs legacy min-only max-direction rows", () => {
    assert.deepEqual(sharedPkg.normalizeThresholdBounds("crashrate", 0.1, null), { min: null, max: 0.1 });
    assert.deepEqual(sharedPkg.normalizeThresholdBounds("smoke", 100, null), { min: 100, max: null });
  });
});

describe("signal scope helpers", () => {
  const thresholdMap = {
    accuracy: { min: 85, max: null, required_for_certification: true },
    smoke: { min: 100, max: null, required_for_certification: true },
    crashrate: { min: null, max: 0.1, required_for_certification: false },
    e2e_regression: { min: 95, max: null, required_for_certification: true }
  };

  it("requires signals marked required for certification", () => {
    assert.equal(isSignalRequiredForRelease("accuracy", { thresholdMap }), true);
    assert.equal(isSignalRequiredForRelease("crashrate", { thresholdMap }), false);
    assert.equal(isSignalRequiredForRelease("accuracy_delta", { thresholdMap }), false);
  });

  it("requires marked signals even when integration is not connected", () => {
    assert.equal(isSignalRequiredForRelease("e2e_regression", { thresholdMap }), true);
    assert.equal(isSignalRequiredForRelease("smoke", { thresholdMap }), true);
  });

  it("does not require signals when toggle is off", () => {
    const map = {
      accuracy: { min: 85, max: null, required_for_certification: false }
    };
    assert.equal(isSignalRequiredForRelease("accuracy", { thresholdMap: map }), false);
  });
});
