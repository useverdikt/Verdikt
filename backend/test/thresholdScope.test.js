"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const sharedPkg = require("../src/lib/sharedPkg");
const { isSignalRequiredForRelease, isE2eRegressionWaived } = require("../src/services/signalScope");

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
  it("requires only in-scope signals", () => {
    const inScope = new Set(["accuracy", "smoke"]);
    assert.equal(isSignalRequiredForRelease("accuracy", { inScopeIds: inScope, releaseRow: {} }), true);
    assert.equal(isSignalRequiredForRelease("crashrate", { inScopeIds: inScope, releaseRow: {} }), false);
    assert.equal(isSignalRequiredForRelease("accuracy_delta", { inScopeIds: inScope, releaseRow: {} }), false);
  });

  it("waives e2e_regression for model_patch releases", () => {
    const rel = { release_type: "model_patch" };
    const inScope = new Set(["e2e_regression", "smoke"]);
    assert.equal(isE2eRegressionWaived(rel), true);
    assert.equal(isSignalRequiredForRelease("e2e_regression", { inScopeIds: inScope, releaseRow: rel }), false);
    assert.equal(isSignalRequiredForRelease("e2e_regression", { inScopeIds: inScope, releaseRow: { release_type: "prompt_update" } }), true);
  });
});
