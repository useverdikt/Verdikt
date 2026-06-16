"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  calibrationSuggestionId
} = require("../src/services/calibrationSuggestions");

describe("calibrationSuggestions", () => {
  it("calibrationSuggestionId is stable per release and signal", () => {
    const id = calibrationSuggestionId("ws1", "rel1", "accuracy", "min");
    assert.equal(id, "cal:ws1:rel1:accuracy:min");
  });
});
