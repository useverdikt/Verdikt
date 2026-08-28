"use strict";

const fs = require("fs");
const path = require("path");
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const sharedDir = path.join(__dirname, "../../shared");

describe("shared severity helpers", async () => {
  const esm = await import("@useverdikt/shared/severity");
  const cjs = require("@useverdikt/shared/severity");

  it("maps showstopper labels to max worst index", () => {
    assert.equal(esm.showstopperLabelToMaxWorstIndex("P0"), 4);
    assert.equal(esm.showstopperLabelToMaxWorstIndex("P1"), 3);
  });

  it("evaluates showstopper gate", () => {
    assert.equal(
      esm.passesShowstopperGate(esm.severityToIndex("P2"), esm.showstopperLabelToMaxWorstIndex("P1")),
      true
    );
    assert.equal(
      esm.passesShowstopperGate(esm.severityToIndex("P0"), esm.showstopperLabelToMaxWorstIndex("P0")),
      false
    );
  });

  it("exports severity levels", () => {
    assert.ok(esm.SEVERITY_LEVELS.includes("P0"));
  });

  it("keeps ESM + CJS dual exports in sync", () => {
    assert.equal(fs.existsSync(path.join(sharedDir, "severity.mjs")), true);
    assert.equal(fs.existsSync(path.join(sharedDir, "severity.cjs")), true);
    assert.equal(fs.existsSync(path.join(sharedDir, "severity.js")), false);
    assert.deepEqual([...esm.SEVERITY_LEVELS], [...cjs.SEVERITY_LEVELS]);
    assert.equal(esm.severityToIndex("P1"), cjs.severityToIndex("P1"));
    assert.equal(esm.showstopperLabelToMaxWorstIndex("P0"), cjs.showstopperLabelToMaxWorstIndex("P0"));
  });
});

describe("shared release status helpers", async () => {
  const esm = await import("@useverdikt/shared/releaseStatus");
  const cjs = require("@useverdikt/shared/releaseStatus");

  it("identifies cert-like statuses", () => {
    assert.equal(esm.isCertLikeStatus("CERTIFIED"), true);
    assert.equal(esm.isCertLikeStatus("CERTIFIED_WITH_OVERRIDE"), true);
    assert.equal(esm.isCertLikeStatus("UNCERTIFIED"), false);
    assert.equal(esm.isCertLikeStatus("CERTIFICATION_REVOKED"), false);
    assert.equal(esm.isVerdictedStatus("CERTIFICATION_REVOKED"), true);
    assert.ok(esm.BACKEND_RELEASE_STATUSES.includes("CERTIFICATION_REVOKED"));
  });

  it("exports cert-like set", () => {
    assert.equal(esm.CERT_LIKE.has("CERTIFIED"), true);
    assert.equal(esm.VERDICTED.has("UNCERTIFIED"), true);
    assert.equal(esm.isVerdictedStatus("CERTIFIED_WITH_OVERRIDE"), true);
  });

  it("normalizes prod environment aliases", () => {
    assert.equal(esm.isProdEnvironment("prod"), true);
    assert.equal(esm.isProdEnvironment("production"), true);
    assert.equal(esm.isProdEnvironment("staging"), false);
  });

  it("keeps ESM + CJS dual exports in sync", () => {
    assert.equal(fs.existsSync(path.join(sharedDir, "releaseStatus.mjs")), true);
    assert.equal(fs.existsSync(path.join(sharedDir, "releaseStatus.cjs")), true);
    assert.equal(fs.existsSync(path.join(sharedDir, "releaseStatus.js")), false);
    assert.equal(esm.isCertLikeStatus("CERTIFIED"), cjs.isCertLikeStatus("CERTIFIED"));
    assert.equal(esm.isProdEnvironment("main"), cjs.isProdEnvironment("main"));
  });
});

describe("shared verdict engine + independent verify dual exports", async () => {
  const engineEsm = await import("@useverdikt/shared/verdictEngine");
  const engineCjs = require("@useverdikt/shared/verdictEngine");
  const verifyEsm = await import("@useverdikt/shared/independentVerify");
  const verifyCjs = require("@useverdikt/shared/independentVerify");
  const chainEsm = await import("@useverdikt/shared/auditChain");
  const chainCjs = require("@useverdikt/shared/auditChain");

  it("keeps ESM + CJS dual exports in sync", () => {
    assert.equal(engineEsm.ENGINE_VERSION, engineCjs.ENGINE_VERSION);
    assert.equal(engineEsm.CERT_BUNDLE_SCHEMA, engineCjs.CERT_BUNDLE_SCHEMA);
    assert.equal(chainEsm.GENESIS, chainCjs.GENESIS);
    assert.equal(
      engineEsm.computeEvidenceHash({ a: { min: 1 } }, { a: 2 }),
      engineCjs.computeEvidenceHash({ a: { min: 1 } }, { a: 2 })
    );
    const replay = engineCjs.evaluateFrozenEvidence(
      { accuracy: 91 },
      { accuracy: { min: 90, required_for_certification: true } }
    );
    assert.equal(replay.engine_status, "CERTIFIED");
    assert.equal(typeof verifyEsm.verifyIndependentBundle, "function");
    assert.equal(typeof verifyCjs.verifyIndependentBundle, "function");
  });
});

describe("shared config dual exports", async () => {
  const esm = await import("@useverdikt/shared");
  const cjs = require("@useverdikt/shared");

  it("exposes threshold helpers from both import and require", () => {
    assert.equal(typeof esm.getDefaultThresholdSeedRows, "function");
    assert.equal(typeof cjs.getDefaultThresholdSeedRows, "function");
    assert.deepEqual(esm.valueToThresholdBounds("smoke", 100), cjs.valueToThresholdBounds("smoke", 100));
    assert.equal(fs.existsSync(path.join(sharedDir, "config.mjs")), true);
    assert.equal(fs.existsSync(path.join(sharedDir, "config.cjs")), true);
    assert.equal(fs.existsSync(path.join(sharedDir, "config.js")), false);
  });
});
