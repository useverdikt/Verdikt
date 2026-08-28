"use strict";

const crypto = require("crypto");
const { queryOne, run } = require("../database");
const { nowIso } = require("../lib/time");
const {
  CERT_SIGNING_KEY,
  JWT_SECRET,
  CERT_ED25519_PRIVATE_KEY,
  CERT_ED25519_PUBLIC_KEY_PEM
} = require("../config");
const { getCertificationSnapshot } = require("./certificationSnapshots");
const {
  ENGINE_VERSION,
  CERT_BUNDLE_SCHEMA,
  computeEvidenceHash
} = require("@useverdikt/shared/verdictEngine");
const {
  buildCanonicalPayload,
  signEd25519: signEd25519Shared,
  verifyEd25519: verifyEd25519Shared
} = require("@useverdikt/shared/independentVerify");

const SIGN_KEY = crypto.createHash("sha256").update(`verdikt:cert-sign:${CERT_SIGNING_KEY}`).digest();
const LEGACY_SIGN_KEY = crypto.createHash("sha256").update(`verdikt:cert-sign:${JWT_SECRET}`).digest();
const SIGNING_KEY_HINT = "hmac-sha256/verdikt-cert-signing-key-v2";
const LEGACY_SIGNING_KEY_HINT = "hmac-sha256/verdikt-cert-signing-key-v1";
const ED25519_KEY_HINT = "ed25519/verdikt-cert-signing-key-v1";
const CERT_ENGINE_VERSION = ENGINE_VERSION;

function verificationKeyFor(signatureRow) {
  return signatureRow?.public_key_hint === LEGACY_SIGNING_KEY_HINT ? LEGACY_SIGN_KEY : SIGN_KEY;
}

function ed25519Configured() {
  return Boolean(CERT_ED25519_PRIVATE_KEY && CERT_ED25519_PUBLIC_KEY_PEM);
}

function buildFrozenBundle({
  snapshot,
  evidenceHash,
  engineVersion,
  algorithm,
  signedAt,
  payloadHash,
  publicKeyHint
}) {
  return {
    schema_version: 1,
    engine_version: engineVersion,
    algorithm,
    public_key_hint: publicKeyHint,
    signed_at: signedAt,
    payload_hash: payloadHash,
    evidence_hash: evidenceHash || null,
    frozen_at: snapshot?.frozen_at || null,
    thresholds: snapshot?.threshold_map || {},
    signals: snapshot?.signal_map || {}
  };
}

function signEd25519(payload, privateKeyPem = CERT_ED25519_PRIVATE_KEY) {
  return signEd25519Shared(payload, privateKeyPem);
}

function verifyEd25519(payload, signatureB64, publicKeyPem) {
  return verifyEd25519Shared(payload, signatureB64, publicKeyPem);
}

function hmacHexEqual(expectedHex, actualHex) {
  const expected = Buffer.from(String(expectedHex || ""), "hex");
  const actual = Buffer.from(String(actualHex || ""), "hex");
  if (expected.length === 0 || expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

function listPublicCertKeys() {
  if (!ed25519Configured()) {
    return {
      engine_version: CERT_ENGINE_VERSION,
      keys: []
    };
  }
  return {
    engine_version: CERT_ENGINE_VERSION,
    keys: [
      {
        algorithm: "ed25519",
        public_key_hint: ED25519_KEY_HINT,
        public_key_pem: CERT_ED25519_PUBLIC_KEY_PEM,
        engine_version: CERT_ENGINE_VERSION
      }
    ]
  };
}

function parseJsonObject(raw, fallback = null) {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return raw;
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

async function signCertificationRecord(release, verdictIntelligence) {
  const existing = await queryOne("SELECT * FROM cert_signatures WHERE release_id = $1", [release.id]);
  if (existing) {
    return {
      payload_hash: existing.payload_hash,
      signature: existing.signature,
      signed_at: existing.signed_at,
      algorithm: existing.algorithm,
      public_key_hint: existing.public_key_hint,
      engine_version: existing.engine_version || null,
      reused: true
    };
  }

  const snapshot = await getCertificationSnapshot(release.id);
  const evidenceHash = snapshot?.evidence_hash || null;
  const signedAt = nowIso();
  const useEd25519 = ed25519Configured();
  const extra = useEd25519 ? { engine_version: CERT_ENGINE_VERSION } : null;
  const payload = buildCanonicalPayload(release, verdictIntelligence, signedAt, evidenceHash, extra);
  const payloadHash = crypto.createHash("sha256").update(payload).digest("hex");

  const algorithm = useEd25519 ? "ed25519" : "hmac-sha256";
  const publicKeyHint = useEd25519 ? ED25519_KEY_HINT : SIGNING_KEY_HINT;
  const signature = useEd25519
    ? signEd25519(payload)
    : crypto.createHmac("sha256", SIGN_KEY).update(payload).digest("hex");
  const publicKeyPem = useEd25519 ? CERT_ED25519_PUBLIC_KEY_PEM : null;
  const bundle = buildFrozenBundle({
    snapshot,
    evidenceHash,
    engineVersion: CERT_ENGINE_VERSION,
    algorithm,
    signedAt,
    payloadHash,
    publicKeyHint
  });

  await run(
    `
    INSERT INTO cert_signatures
      (release_id, workspace_id, algorithm, payload_hash, signature, signed_at, signed_by,
       public_key_hint, engine_version, bundle_json, public_key_pem)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT(release_id) DO NOTHING
  `,
    [
      release.id,
      release.workspace_id,
      algorithm,
      payloadHash,
      signature,
      signedAt,
      "system",
      publicKeyHint,
      CERT_ENGINE_VERSION,
      JSON.stringify(bundle),
      publicKeyPem
    ]
  );

  const stored =
    (await queryOne("SELECT * FROM cert_signatures WHERE release_id = $1", [release.id])) || null;

  return {
    payload_hash: stored?.payload_hash || payloadHash,
    signature: stored?.signature || signature,
    signed_at: stored?.signed_at || signedAt,
    algorithm: stored?.algorithm || algorithm,
    public_key_hint: stored?.public_key_hint || publicKeyHint,
    engine_version: stored?.engine_version || CERT_ENGINE_VERSION,
    evidence_hash: evidenceHash
  };
}

async function verifyCertificationRecord(releaseId) {
  const sigRow = await queryOne("SELECT * FROM cert_signatures WHERE release_id = $1", [releaseId]);
  if (!sigRow) return { valid: false, reason: "no_signature_on_record" };

  const release = await queryOne("SELECT * FROM releases WHERE id = $1", [releaseId]);
  if (!release) return { valid: false, reason: "release_not_found" };

  const intel = await queryOne("SELECT verdict_json FROM release_intelligence WHERE release_id = $1", [releaseId]);
  const verdict = intel?.verdict_json ? JSON.parse(intel.verdict_json) : null;
  const snapshot = await getCertificationSnapshot(releaseId);
  const algorithm = String(sigRow.algorithm || "hmac-sha256").toLowerCase();
  const extra =
    algorithm === "ed25519"
      ? { engine_version: sigRow.engine_version || CERT_ENGINE_VERSION }
      : null;
  const payload = buildCanonicalPayload(release, verdict, sigRow.signed_at, snapshot?.evidence_hash || null, extra);
  const payloadHash = crypto.createHash("sha256").update(payload).digest("hex");
  const hashMatch = payloadHash === sigRow.payload_hash;
  if (!hashMatch) return { valid: false, reason: "payload_hash_mismatch", signed_at: sigRow.signed_at };

  if (algorithm === "ed25519") {
    const publicKeyPem = sigRow.public_key_pem || CERT_ED25519_PUBLIC_KEY_PEM;
    if (!publicKeyPem) return { valid: false, reason: "missing_ed25519_public_key", signed_at: sigRow.signed_at };
    let sigMatch = false;
    try {
      sigMatch = verifyEd25519(payload, sigRow.signature, publicKeyPem);
    } catch {
      sigMatch = false;
    }
    if (!sigMatch) return { valid: false, reason: "signature_mismatch", signed_at: sigRow.signed_at };
  } else {
    const expectedSig = crypto.createHmac("sha256", verificationKeyFor(sigRow)).update(payload).digest("hex");
    if (!hmacHexEqual(expectedSig, sigRow.signature)) {
      return { valid: false, reason: "signature_mismatch", signed_at: sigRow.signed_at };
    }
  }

  return {
    valid: true,
    reason: "ok",
    signed_at: sigRow.signed_at,
    payload_hash: sigRow.payload_hash,
    algorithm: sigRow.algorithm,
    public_key_hint: sigRow.public_key_hint,
    engine_version: sigRow.engine_version || null,
    evidence_hash: snapshot?.evidence_hash || null
  };
}

async function getCertSignaturePublic(releaseId) {
  const row =
    (await queryOne(
      `SELECT release_id, workspace_id, algorithm, payload_hash, signature, signed_at,
              public_key_hint, engine_version
         FROM cert_signatures WHERE release_id = $1`,
      [releaseId]
    )) || null;
  if (!row) return null;
  const snapshot = await getCertificationSnapshot(releaseId);
  return {
    ...row,
    evidence_hash: snapshot?.evidence_hash || null
  };
}

function evidenceFromStoredBundle(sigRow, snapshot) {
  const stored = parseJsonObject(sigRow?.bundle_json, {});
  const thresholds = snapshot?.threshold_map || stored?.thresholds || {};
  const signals = snapshot?.signal_map || stored?.signals || {};
  const evidenceHash = snapshot?.evidence_hash || stored?.evidence_hash || computeEvidenceHash(thresholds, signals);
  return {
    evidence_hash: evidenceHash || null,
    frozen_at: snapshot?.frozen_at || stored?.frozen_at || null,
    thresholds,
    signals,
    status_at_verdict: snapshot?.status_at_verdict || null
  };
}

/**
 * Self-contained cert file for `verdikt-verify`. Rebuilds signed_payload from
 * stored identity so HMAC rows stay field-stable and Ed25519 includes engine_version.
 */
async function assembleIndependentCertBundle(releaseId) {
  const sigRow = await queryOne("SELECT * FROM cert_signatures WHERE release_id = $1", [releaseId]);
  if (!sigRow) return null;
  const release = await queryOne("SELECT * FROM releases WHERE id = $1", [releaseId]);
  if (!release) return null;

  const intel = await queryOne(
    "SELECT verdict_json, override_json FROM release_intelligence WHERE release_id = $1",
    [releaseId]
  );
  const verdict = parseJsonObject(intel?.verdict_json, {}) || {};
  const override = parseJsonObject(intel?.override_json, null);
  const snapshot = await getCertificationSnapshot(releaseId);
  const evidence = evidenceFromStoredBundle(sigRow, snapshot);
  const algorithm = String(sigRow.algorithm || "hmac-sha256").toLowerCase();
  const extra = algorithm === "ed25519" ? { engine_version: sigRow.engine_version || CERT_ENGINE_VERSION } : null;
  const signedPayload = buildCanonicalPayload(
    release,
    verdict,
    sigRow.signed_at,
    evidence.evidence_hash || null,
    extra
  );

  let chainAnchor = null;
  try {
    const { getLatestPublicAnchor } = require("./auditAnchor");
    chainAnchor = await getLatestPublicAnchor(release.workspace_id);
  } catch {
    chainAnchor = null;
  }

  return {
    schema: CERT_BUNDLE_SCHEMA,
    schema_version: 2,
    engine_version: sigRow.engine_version || CERT_ENGINE_VERSION,
    algorithm: sigRow.algorithm,
    public_key_hint: sigRow.public_key_hint || null,
    public_key_pem: sigRow.public_key_pem || (algorithm === "ed25519" ? CERT_ED25519_PUBLIC_KEY_PEM : null),
    signature: sigRow.signature,
    signed_at: sigRow.signed_at,
    signed_payload: signedPayload,
    payload_hash: sigRow.payload_hash,
    release: {
      id: release.id,
      workspace_id: release.workspace_id,
      version: release.version,
      release_type: release.release_type,
      environment: release.environment || "",
      verdict_issued_at: release.verdict_issued_at || null
    },
    recorded_status: release.status,
    failed_signals: Array.isArray(verdict.failed_signals) ? verdict.failed_signals : [],
    override: override
      ? {
          approver_name: override.approver_name || override.owner || null,
          approver_role: override.approver_role || override.title || null,
          justification: override.justification || override.reason || null
        }
      : null,
    evidence,
    chain_anchor: chainAnchor
  };
}

module.exports = {
  CERT_ENGINE_VERSION,
  CERT_BUNDLE_SCHEMA,
  ED25519_KEY_HINT,
  SIGNING_KEY_HINT,
  buildCanonicalPayload,
  buildFrozenBundle,
  signEd25519,
  verifyEd25519,
  listPublicCertKeys,
  signCertificationRecord,
  verifyCertificationRecord,
  getCertSignaturePublic,
  assembleIndependentCertBundle
};
