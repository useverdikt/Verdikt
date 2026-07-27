"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { CERT_LIKE, VERDICTED, isCertLikeStatus, isVerdictedStatus, isProdEnvironment } = require("../../shared/releaseStatus.js");

describe("shared severity helpers", async () => {
  const {
    SEVERITY_LEVELS,
    showstopperLabelToMaxWorstIndex,
    passesShowstopperGate,
    severityToIndex
  } = await import("../../shared/severity.mjs");

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

  it("has a single ESM implementation (no CJS duplicate)", () => {
    const fs = require("fs");
    const path = require("path");
    const sharedDir = path.join(__dirname, "../../shared");
    assert.equal(fs.existsSync(path.join(sharedDir, "severity.mjs")), true);
    assert.equal(fs.existsSync(path.join(sharedDir, "severity.js")), false);
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
