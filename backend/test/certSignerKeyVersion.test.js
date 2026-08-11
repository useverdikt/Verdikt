"use strict";

process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || process.env.DATABASE_URL || "postgresql://127.0.0.1:5432/verdikt_test";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
process.env.CERT_SIGNING_KEY = "test-cert-signing-key-32-chars-minimum!!";
process.env.WEBHOOK_SECRET = "test-webhook-secret-24-char-min";

const { before, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { initDatabase, queryOne, run } = require("../src/database");
const {
  signCertificationRecord,
  verifyCertificationRecord
} = require("../src/services/certSigner");
const { ensureWorkspaceSeeded } = require("../src/services/workspaceConfig");
const { nowIso } = require("../src/lib/time");

function canonicalPayload(release, signedAt) {
  const fields = {
    release_id: release.id,
    workspace_id: release.workspace_id,
    version: release.version,
    release_type: release.release_type,
    environment: release.environment || "",
    status: release.status,
    verdict_issued_at: release.verdict_issued_at || signedAt,
    failed_signal_count: 0,
    evidence_hash: null,
    signed_at: signedAt
  };
  return JSON.stringify(fields, Object.keys(fields).sort());
}

async function createCertifiedRelease(suffix) {
  const workspaceId = `ws_cert_key_${suffix}`;
  const releaseId = `rel_cert_key_${suffix}`;
  const ts = nowIso();
  await ensureWorkspaceSeeded(workspaceId);
  await run(
    `INSERT INTO releases
      (id, workspace_id, version, release_type, environment, status, created_at, updated_at, verdict_issued_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [releaseId, workspaceId, `key-${suffix}`, "model_update", "pre-prod", "CERTIFIED", ts, ts, ts]
  );
  return queryOne("SELECT * FROM releases WHERE id = $1", [releaseId]);
}

before(async () => {
  await initDatabase();
});

describe("certification signing key versions", () => {
  it("writes new signatures with the independent v2 key", async () => {
    const release = await createCertifiedRelease(crypto.randomBytes(4).toString("hex"));
    await signCertificationRecord(release, null);

    const row = await queryOne("SELECT * FROM cert_signatures WHERE release_id = $1", [release.id]);
    assert.equal(row.public_key_hint, "hmac-sha256/verdikt-cert-signing-key-v2");
    assert.equal((await verifyCertificationRecord(release.id)).valid, true);
  });

  it("continues to verify legacy v1 JWT-derived signatures", async () => {
    const release = await createCertifiedRelease(crypto.randomBytes(4).toString("hex"));
    const signedAt = nowIso();
    const payload = canonicalPayload(release, signedAt);
    const payloadHash = crypto.createHash("sha256").update(payload).digest("hex");
    const legacyKey = crypto
      .createHash("sha256")
      .update(`verdikt:cert-sign:${process.env.JWT_SECRET}`)
      .digest();
    const signature = crypto.createHmac("sha256", legacyKey).update(payload).digest("hex");

    await run(
      `INSERT INTO cert_signatures
        (release_id, workspace_id, algorithm, payload_hash, signature, signed_at, signed_by, public_key_hint)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        release.id,
        release.workspace_id,
        "hmac-sha256",
        payloadHash,
        signature,
        signedAt,
        "system",
        "hmac-sha256/verdikt-cert-signing-key-v1"
      ]
    );

    assert.equal((await verifyCertificationRecord(release.id)).valid, true);
  });
});
