"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const {
  ENGINE_VERSION,
  CERT_BUNDLE_SCHEMA,
  computeEvidenceHash,
  evaluateFrozenEvidence
} = require("@useverdikt/shared/verdictEngine");
const { GENESIS, computeAuditRowHash, buildAnchorPayload } = require("@useverdikt/shared/auditChain");
const {
  buildCanonicalPayload,
  signEd25519,
  verifyIndependentBundle,
  verifyAuditExportChain,
  verifyAnchorAgainstChain
} = require("@useverdikt/shared/independentVerify");

const CLI = path.join(__dirname, "../../scripts/verdikt-verify.js");

function ed25519Pair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  return {
    privatePem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicPem: publicKey.export({ type: "spki", format: "pem" }).toString()
  };
}

function certifiedMaps() {
  const thresholds = { accuracy: { min: 90, required_for_certification: true } };
  const signals = { accuracy: 94 };
  return { thresholds, signals, evidence_hash: computeEvidenceHash(thresholds, signals) };
}

function makeBundle({ algorithm, privatePem, publicPem, recorded_status, failed_signals, extraEvidence, engine_version }) {
  const { thresholds, signals, evidence_hash } = certifiedMaps();
  const release = {
    id: "rel_1",
    workspace_id: "ws_1",
    version: "v1.0.0",
    release_type: "model_update",
    environment: "pre-prod",
    status: recorded_status,
    verdict_issued_at: "2026-08-28T00:00:00.000Z"
  };
  const signedAt = "2026-08-28T00:00:01.000Z";
  const verdict = { failed_signals: failed_signals || [] };
  const extra = algorithm === "ed25519" ? { engine_version: engine_version || ENGINE_VERSION } : null;
  const signed_payload = buildCanonicalPayload(release, verdict, signedAt, evidence_hash, extra);
  const signature =
    algorithm === "ed25519" ? signEd25519(signed_payload, privatePem) : crypto.createHmac("sha256", "secret").update(signed_payload).digest("hex");
  return {
    schema: CERT_BUNDLE_SCHEMA,
    engine_version: engine_version || ENGINE_VERSION,
    algorithm,
    public_key_pem: publicPem || null,
    signature,
    signed_at: signedAt,
    signed_payload,
    recorded_status,
    failed_signals: verdict.failed_signals,
    release,
    evidence: {
      evidence_hash,
      frozen_at: signedAt,
      thresholds: extraEvidence?.thresholds || thresholds,
      signals: extraEvidence?.signals || signals
    }
  };
}

describe("independent cert verify (no DB)", () => {
  it("Ed25519 round-trip: signature + evidence hash + engine replay", () => {
    const keys = ed25519Pair();
    const bundle = makeBundle({
      algorithm: "ed25519",
      privatePem: keys.privatePem,
      publicPem: keys.publicPem,
      recorded_status: "CERTIFIED",
      failed_signals: []
    });
    const result = verifyIndependentBundle(bundle);
    assert.equal(result.ok, true);
    assert.equal(result.independently_verifiable, true);
    assert.equal(result.checks.engine, true);
    assert.equal(result.checks.evidence_hash, true);
    assert.equal(result.checks.signature, "valid");
    assert.equal(result.replay.engine_status, "CERTIFIED");
  });

  it("rejects a signed blob whose frozen inputs no longer produce the recorded verdict", () => {
    const keys = ed25519Pair();
    const bundle = makeBundle({
      algorithm: "ed25519",
      privatePem: keys.privatePem,
      publicPem: keys.publicPem,
      recorded_status: "CERTIFIED",
      failed_signals: []
    });
    bundle.evidence.signals = { accuracy: 10 };
    bundle.evidence.evidence_hash = computeEvidenceHash(bundle.evidence.thresholds, bundle.evidence.signals);
    const result = verifyIndependentBundle(bundle);
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes("engine_verdict_mismatch"));
    assert.ok(result.errors.includes("signed_payload_mismatch"));
    assert.equal(result.replay.engine_status, "UNCERTIFIED");
  });

  it("HMAC bundles replay the engine but are not independently signed", () => {
    const bundle = makeBundle({
      algorithm: "hmac-sha256",
      recorded_status: "CERTIFIED",
      failed_signals: []
    });
    const result = verifyIndependentBundle(bundle);
    assert.equal(result.ok, true);
    assert.equal(result.independently_verifiable, false);
    assert.equal(result.checks.signature, "hmac_not_independently_verifiable");
    assert.equal(result.checks.engine, true);
  });

  it("override status requires an UNCERTIFIED engine replay", () => {
    const thresholds = { accuracy: { min: 90, required_for_certification: true } };
    const signals = { accuracy: 70 };
    const evidence_hash = computeEvidenceHash(thresholds, signals);
    const keys = ed25519Pair();
    const bundle = makeBundle({
      algorithm: "ed25519",
      privatePem: keys.privatePem,
      publicPem: keys.publicPem,
      recorded_status: "CERTIFIED_WITH_OVERRIDE",
      failed_signals: [{ signal_id: "accuracy", value: 70, failure_kind: "absolute_threshold", rule: ">= 90" }],
      extraEvidence: { thresholds, signals }
    });
    bundle.evidence.evidence_hash = evidence_hash;
    bundle.signed_payload = buildCanonicalPayload(
      { ...bundle.release, status: "CERTIFIED_WITH_OVERRIDE" },
      { failed_signals: bundle.failed_signals },
      bundle.signed_at,
      evidence_hash,
      { engine_version: ENGINE_VERSION }
    );
    bundle.signature = signEd25519(bundle.signed_payload, keys.privatePem);
    const result = verifyIndependentBundle(bundle);
    assert.equal(result.ok, true);
    assert.equal(result.replay.engine_status, "UNCERTIFIED");
  });

  it("folds recorded delta failures into the engine result", () => {
    const keys = ed25519Pair();
    const deltaFail = [{ signal_id: "accuracy_delta", value: -12, failure_kind: "delta_regression", rule: "delta" }];
    const bundle = makeBundle({
      algorithm: "ed25519",
      privatePem: keys.privatePem,
      publicPem: keys.publicPem,
      recorded_status: "UNCERTIFIED",
      failed_signals: deltaFail
    });
    const result = verifyIndependentBundle(bundle);
    assert.equal(result.ok, true);
    assert.equal(result.replay.engine_status, "UNCERTIFIED");
    assert.equal(result.replay.recorded_delta_failures.length, 1);
  });

  it("fails closed on an unknown engine version", () => {
    const keys = ed25519Pair();
    const bundle = makeBundle({
      algorithm: "ed25519",
      privatePem: keys.privatePem,
      publicPem: keys.publicPem,
      recorded_status: "CERTIFIED",
      failed_signals: [],
      engine_version: "1999.01.1"
    });
    const result = verifyIndependentBundle(bundle);
    assert.equal(result.ok, false);
    assert.ok(result.errors.includes("unsupported_engine_version"));
  });

  it("absolute threshold math matches evaluateFrozenEvidence", () => {
    const replay = evaluateFrozenEvidence(
      { accuracy: 80 },
      { accuracy: { min: 90, required_for_certification: true } }
    );
    assert.equal(replay.engine_status, "UNCERTIFIED");
    assert.equal(replay.failed_signals[0].failure_kind, "absolute_threshold");
  });
});

describe("independent audit chain + anchor (no DB)", () => {
  it("recomputes a two-row chain and checks a signed tip", () => {
    const keys = ed25519Pair();
    const row1 = {
      id: 1,
      workspace_id: "ws_1",
      release_id: null,
      event_type: "RELEASE_OPENED",
      actor_type: "USER",
      actor_name: "ada@example.com",
      details_json: "{\"ok\":true}",
      created_at: "2026-08-28T00:00:00.000Z",
      prev_hash: GENESIS
    };
    row1.row_hash = computeAuditRowHash(row1, GENESIS);
    const row2 = {
      id: 2,
      workspace_id: "ws_1",
      release_id: "rel_1",
      event_type: "VERDICT_ISSUED",
      actor_type: "SYSTEM",
      actor_name: "verdikt",
      details_json: "{\"status\":\"CERTIFIED\"}",
      created_at: "2026-08-28T00:00:01.000Z",
      prev_hash: row1.row_hash
    };
    row2.row_hash = computeAuditRowHash(row2, row1.row_hash);
    const chain = verifyAuditExportChain([row1, row2], { expectedWorkspaceId: "ws_1" });
    assert.equal(chain.valid, true);
    assert.equal(chain.tip_row_hash, row2.row_hash);

    const anchoredAt = "2026-08-28T00:05:00.000Z";
    const signed_payload = buildAnchorPayload({
      workspaceId: "ws_1",
      tipEventId: 2,
      tipRowHash: row2.row_hash,
      eventCount: 2,
      anchoredAt
    });
    const anchor = {
      schema: "verdikt.anchor.v1",
      workspace_id: "ws_1",
      tip_event_id: 2,
      tip_row_hash: row2.row_hash,
      event_count: 2,
      anchored_at: anchoredAt,
      algorithm: "ed25519",
      public_key_pem: keys.publicPem,
      signature: signEd25519(signed_payload, keys.privatePem),
      signed_payload,
      external_kind: "none"
    };
    const checked = verifyAnchorAgainstChain(anchor, chain);
    assert.equal(checked.ok, true);
    assert.equal(checked.independently_verifiable, true);
  });

  it("detects a tampered details_json", () => {
    const row = {
      id: 1,
      workspace_id: "ws_1",
      event_type: "RELEASE_OPENED",
      actor_type: "USER",
      actor_name: "ada",
      details_json: "{\"ok\":true}",
      created_at: "2026-08-28T00:00:00.000Z",
      prev_hash: GENESIS
    };
    row.row_hash = computeAuditRowHash(row, GENESIS);
    const tampered = { ...row, details_json: "{\"ok\":false}" };
    const chain = verifyAuditExportChain([tampered], { expectedWorkspaceId: "ws_1" });
    assert.equal(chain.valid, false);
    assert.equal(chain.tampered.length, 1);
  });
});

describe("verdikt-verify CLI", () => {
  it("exits 0 for a valid Ed25519 bundle and 1 when the engine disagrees", () => {
    const keys = ed25519Pair();
    const okBundle = makeBundle({
      algorithm: "ed25519",
      privatePem: keys.privatePem,
      publicPem: keys.publicPem,
      recorded_status: "CERTIFIED",
      failed_signals: []
    });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "verdikt-verify-"));
    const okPath = path.join(dir, "ok.json");
    const badPath = path.join(dir, "bad.json");
    fs.writeFileSync(okPath, JSON.stringify(okBundle));
    const bad = structuredClone(okBundle);
    bad.evidence.signals = { accuracy: 1 };
    bad.evidence.evidence_hash = computeEvidenceHash(bad.evidence.thresholds, bad.evidence.signals);
    fs.writeFileSync(badPath, JSON.stringify(bad));

    const okRun = spawnSync(process.execPath, [CLI, okPath], { encoding: "utf8" });
    assert.equal(okRun.status, 0, okRun.stderr);
    const okJson = JSON.parse(okRun.stdout);
    assert.equal(okJson.ok, true);
    assert.equal(okJson.independently_verifiable, true);

    const badRun = spawnSync(process.execPath, [CLI, badPath], { encoding: "utf8" });
    assert.equal(badRun.status, 1);
    const badJson = JSON.parse(badRun.stderr);
    assert.equal(badJson.ok, false);
  });
});
