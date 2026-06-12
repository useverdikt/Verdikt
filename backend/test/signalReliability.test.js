"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { toGrade, cv } = require("../src/services/signalReliability");

describe("signalReliability helpers", () => {
  it("maps reliability score to letter grades", () => {
    assert.equal(toGrade(0.95), "A");
    assert.equal(toGrade(0.8), "B");
    assert.equal(toGrade(0.65), "C");
    assert.equal(toGrade(0.45), "D");
    assert.equal(toGrade(0.1), "F");
  });

  it("computes coefficient of variation", () => {
    assert.equal(cv([]), 0);
    assert.equal(cv([5, 5, 5]), 0);
    assert.ok(cv([1, 3, 5]) > 0);
  });
});
