"use strict";

const crypto = require("crypto");
const { queryOne, run } = require("../database");
const { nowIso } = require("../lib/time");
const { JWT_SECRET } = require("../config");

const SIGN_KEY = crypto.createHash("sha256").update(`verdikt:cert-sign:${JWT_SECRET}`).digest();

function buildCanonicalPayload(release, verdict, signedAt) {
  const fields = {
    release_id: release.id,
    workspace_id: release.workspace_id,
    version: release.version,
    release_type: release.release_type,
    environment: release.environment || "",
    status: release.status,
    verdict_issued_at: release.verdict_issued_at || signedAt,
    failed_signal_count: Array.isArray(verdict?.failed_signals) ? verdict.failed_signals.length : 0,
    signed_at: signedAt
  };
  return JSON.stringify(fields, Object.keys(fields).sort());
}

async function signCertificationRecord(release, verdictIntelligence) {
  const signedAt = nowIso();
  const payload = buildCanonicalPayload(release, verdictIntelligence, signedAt);
  const payloadHash = crypto.createHash("sha256").update(payload).digest("hex");
  const signature = crypto.createHmac("sha256", SIGN_KEY).update(payload).digest("hex");

  await run(
    `
    INSERT INTO cert_signatures
      (release_id, workspace_id, algorithm, payload_hash, signature, signed_at, signed_by, public_key_hint)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(release_id) DO UPDATE SET
      payload_hash = excluded.payload_hash,
      signature    = excluded.signature,
      signed_at    = excluded.signed_at
  `,
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

  return { payload_hash: payloadHash, signature, signed_at: signedAt };
}

async function verifyCertificationRecord(releaseId) {
  const sigRow = await queryOne("SELECT * FROM cert_signatures WHERE release_id = ?", [releaseId]);
  if (!sigRow) return { valid: false, reason: "no_signature_on_record" };

  const release = await queryOne("SELECT * FROM releases WHERE id = ?", [releaseId]);
  if (!release) return { valid: false, reason: "release_not_found" };

  const intel = await queryOne("SELECT verdict_json FROM release_intelligence WHERE release_id = ?", [releaseId]);
  const verdict = intel?.verdict_json ? JSON.parse(intel.verdict_json) : null;

  const payload = buildCanonicalPayload(release, verdict, sigRow.signed_at);
  const payloadHash = crypto.createHash("sha256").update(payload).digest("hex");
  const expectedSig = crypto.createHmac("sha256", SIGN_KEY).update(payload).digest("hex");

  const hashMatch = payloadHash === sigRow.payload_hash;
  const sigMatch = crypto.timingSafeEqual(Buffer.from(expectedSig, "hex"), Buffer.from(sigRow.signature, "hex"));

  if (!hashMatch) return { valid: false, reason: "payload_hash_mismatch", signed_at: sigRow.signed_at };
  if (!sigMatch) return { valid: false, reason: "signature_mismatch", signed_at: sigRow.signed_at };

  return {
    valid: true,
    reason: "ok",
    signed_at: sigRow.signed_at,
    payload_hash: sigRow.payload_hash,
    algorithm: sigRow.algorithm,
    public_key_hint: sigRow.public_key_hint
  };
}

async function getCertSignaturePublic(releaseId) {
  return (
    (await queryOne(
      "SELECT release_id, workspace_id, algorithm, payload_hash, signature, signed_at, public_key_hint FROM cert_signatures WHERE release_id = ?",
      [releaseId]
    )) || null
  );
}

module.exports = { signCertificationRecord, verifyCertificationRecord, getCertSignaturePublic };
