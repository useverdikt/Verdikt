"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const {
  SEVERITY_LEVELS,
  showstopperLabelToMaxWorstIndex,
  passesShowstopperGate,
  severityToIndex
} = require("../../shared/severity.js");
const { CERT_LIKE, VERDICTED, isCertLikeStatus, isVerdictedStatus, isProdEnvironment } = require("../../shared/releaseStatus.js");

describe("shared severity helpers", () => {
  it("maps showstopper labels to max worst index", () => {
    assert.equal(showstopperLabelToMaxWorstIndex("P0"), 4);
    assert.equal(showstopperLabelToMaxWorstIndex("P1"), 3);
  });

  it("evaluates showstopper gate", () => {
    assert.equal(passesShowstopperGate(severityToIndex("P2"), showstopperLabelToMaxWorstIndex("P1")), true);
    assert.equal(passesShowstopperGate(severityToIndex("P0"), showstopperLabelToMaxWorstIndex("P0")), false);
  });

  it("exports severity levels", () => {
    assert.ok(SEVERITY_LEVELS.includes("P0"));
  });
});

describe("shared release status helpers", () => {
  it("identifies cert-like statuses", () => {
    assert.equal(isCertLikeStatus("CERTIFIED"), true);
    assert.equal(isCertLikeStatus("CERTIFIED_WITH_OVERRIDE"), true);
    assert.equal(isCertLikeStatus("UNCERTIFIED"), false);
  });

  it("exports cert-like set", () => {
    assert.equal(CERT_LIKE.has("CERTIFIED"), true);
    assert.equal(VERDICTED.has("UNCERTIFIED"), true);
    assert.equal(isVerdictedStatus("CERTIFIED_WITH_OVERRIDE"), true);
  });

  it("normalizes prod environment aliases", () => {
    assert.equal(isProdEnvironment("prod"), true);
    assert.equal(isProdEnvironment("production"), true);
    assert.equal(isProdEnvironment("staging"), false);
  });
});
