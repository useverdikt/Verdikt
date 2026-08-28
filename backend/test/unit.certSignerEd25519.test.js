"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
process.env.CERT_SIGNING_KEY = "test-cert-signing-key-32-chars-minimum!!";
process.env.WEBHOOK_SECRET = "test-webhook-secret-24-char-min";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {
  CERT_ENGINE_VERSION,
  buildCanonicalPayload,
  buildFrozenBundle,
  signEd25519,
  verifyEd25519,
  listPublicCertKeys
} = require("../src/services/certSigner");

describe("Ed25519 cert signing helpers", () => {
  const release = {
    id: "rel_1",
    workspace_id: "ws_1",
    version: "v1",
    release_type: "model_update",
    environment: "pre-prod",
    status: "CERTIFIED",
    verdict_issued_at: "2026-08-28T00:00:00.000Z"
  };

  it("keeps HMAC canonical payloads free of engine_version", () => {
    const hmac = JSON.parse(buildCanonicalPayload(release, { failed_signals: [] }, "2026-08-28T00:00:00.000Z", null));
    assert.equal(Object.prototype.hasOwnProperty.call(hmac, "engine_version"), false);
    const ed = JSON.parse(
      buildCanonicalPayload(release, { failed_signals: [] }, "2026-08-28T00:00:00.000Z", "hash", {
        engine_version: CERT_ENGINE_VERSION
      })
    );
    assert.equal(ed.engine_version, CERT_ENGINE_VERSION);
    assert.equal(ed.evidence_hash, "hash");
  });

  it("round-trips an Ed25519 signature and frozen bundle", () => {
    const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
    const privatePem = privateKey.export({ type: "pkcs8", format: "pem" });
    const publicPem = publicKey.export({ type: "spki", format: "pem" });
    const payload = buildCanonicalPayload(release, {}, "2026-08-28T00:00:00.000Z", "ev", {
      engine_version: CERT_ENGINE_VERSION
    });
    const signature = signEd25519(payload, privatePem);
    assert.equal(verifyEd25519(payload, signature, publicPem), true);
    const bundle = buildFrozenBundle({
      snapshot: { frozen_at: "2026-08-28T00:00:00.000Z", threshold_map: { accuracy: { min: 90 } }, signal_map: { accuracy: 94 } },
      evidenceHash: "ev",
      engineVersion: CERT_ENGINE_VERSION,
      algorithm: "ed25519",
      signedAt: "2026-08-28T00:00:00.000Z",
      payloadHash: "ph",
      publicKeyHint: "ed25519/verdikt-cert-signing-key-v1"
    });
    assert.equal(bundle.thresholds.accuracy.min, 90);
    assert.equal(bundle.signals.accuracy, 94);
    assert.equal(bundle.evidence_hash, "ev");
  });

  it("does not advertise a public key when Ed25519 is unset", () => {
    const published = listPublicCertKeys();
    assert.equal(Array.isArray(published.keys), true);
    assert.equal(published.keys.length, 0);
  });
});
