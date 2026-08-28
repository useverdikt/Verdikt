/**
 * Independent certificate + chain verification. Must stay in sync with independentVerify.cjs.
 */

import crypto from "node:crypto";
import {
  ENGINE_VERSION,
  CERT_BUNDLE_SCHEMA,
  computeEvidenceHash,
  evaluateFrozenEvidence,
  recordedStatusAgrees
} from "./verdictEngine.mjs";
import { verifyAuditExportChain, buildAnchorPayload, ANCHOR_SCHEMA } from "./auditChain.mjs";

export { ENGINE_VERSION, CERT_BUNDLE_SCHEMA, verifyAuditExportChain };
export const SUPPORTED_ENGINE_VERSIONS = [ENGINE_VERSION];

export function buildCanonicalPayload(release, verdict, signedAt, evidenceHash = null, extra = null) {
  const fields = {
    release_id: release.id,
    workspace_id: release.workspace_id,
    version: release.version,
    release_type: release.release_type,
    environment: release.environment || "",
    status: release.status,
    verdict_issued_at: release.verdict_issued_at || signedAt,
    failed_signal_count: Array.isArray(verdict?.failed_signals)
      ? verdict.failed_signals.length
      : Array.isArray(verdict?.likely_failure_modes)
        ? verdict.likely_failure_modes.length
        : 0,
    evidence_hash: evidenceHash || null,
    signed_at: signedAt
  };
  if (extra && typeof extra === "object") {
    Object.assign(fields, extra);
  }
  return JSON.stringify(fields, Object.keys(fields).sort());
}

export function verifyEd25519(payload, signatureB64, publicKeyPem) {
  const key = crypto.createPublicKey(publicKeyPem);
  return crypto.verify(null, Buffer.from(payload), key, Buffer.from(signatureB64, "base64"));
}

export function signEd25519(payload, privateKeyPem) {
  const key = crypto.createPrivateKey(privateKeyPem);
  return crypto.sign(null, Buffer.from(payload), key).toString("base64");
}

export function isEd25519Algorithm(algorithm) {
  return String(algorithm || "").toLowerCase() === "ed25519";
}

function releaseIdentityFromBundle(bundle) {
  const release = bundle.release && typeof bundle.release === "object" ? bundle.release : {};
  return {
    id: release.id || bundle.release_id,
    workspace_id: release.workspace_id || bundle.workspace_id,
    version: release.version,
    release_type: release.release_type,
    environment: release.environment || "",
    status: bundle.recorded_status || release.status,
    verdict_issued_at: release.verdict_issued_at || bundle.verdict_issued_at
  };
}

export function expectedSignedPayloadFromBundle(bundle) {
  const evidence = bundle.evidence && typeof bundle.evidence === "object" ? bundle.evidence : {};
  const extra = isEd25519Algorithm(bundle.algorithm)
    ? { engine_version: bundle.engine_version || ENGINE_VERSION }
    : null;
  return buildCanonicalPayload(
    releaseIdentityFromBundle(bundle),
    { failed_signals: Array.isArray(bundle.failed_signals) ? bundle.failed_signals : [] },
    bundle.signed_at,
    evidence.evidence_hash || bundle.evidence_hash || null,
    extra
  );
}

export function replayEngine(bundle) {
  const evidence = bundle.evidence || {};
  const thresholds = evidence.thresholds || bundle.thresholds || {};
  const signals = evidence.signals || bundle.signals || {};
  const replay = evaluateFrozenEvidence(signals, thresholds);
  const recordedDeltaFailures = (Array.isArray(bundle.failed_signals) ? bundle.failed_signals : []).filter(
    (row) => row && row.failure_kind && row.failure_kind !== "absolute_threshold"
  );
  const combined = [...replay.failed_signals, ...recordedDeltaFailures];
  const engine_status = combined.length === 0 ? "CERTIFIED" : "UNCERTIFIED";
  return { ...replay, engine_status, failed_signals: combined, recorded_delta_failures: recordedDeltaFailures };
}

export function verifyIndependentBundle(bundle) {
  const checks = {
    schema: false,
    engine_version: false,
    evidence_hash: false,
    engine: false,
    payload_binds: true,
    signature: "skipped"
  };
  const errors = [];
  if (!bundle || typeof bundle !== "object") {
    return { ok: false, checks, errors: ["bundle_not_object"] };
  }
  if (bundle.schema !== CERT_BUNDLE_SCHEMA && bundle.schema_version !== 1 && bundle.schema_version !== 2) {
    errors.push("unknown_schema");
  } else {
    checks.schema = true;
  }

  const engineVersion = bundle.engine_version || null;
  if (engineVersion && SUPPORTED_ENGINE_VERSIONS.includes(engineVersion)) {
    checks.engine_version = true;
  } else if (!engineVersion) {
    errors.push("engine_version_missing");
  } else {
    errors.push("unsupported_engine_version");
  }

  const evidence = bundle.evidence || {};
  const thresholds = evidence.thresholds || bundle.thresholds || {};
  const signals = evidence.signals || bundle.signals || {};
  const expectedHash = evidence.evidence_hash || bundle.evidence_hash || null;
  const recomputedHash = computeEvidenceHash(thresholds, signals);
  if (expectedHash && recomputedHash === expectedHash) {
    checks.evidence_hash = true;
  } else if (!expectedHash) {
    errors.push("evidence_hash_missing");
  } else {
    errors.push("evidence_hash_mismatch");
  }

  const replay = replayEngine(bundle);
  const recorded = bundle.recorded_status || bundle.release?.status || evidence.status_at_verdict;
  if (recordedStatusAgrees(recorded, replay.engine_status)) {
    checks.engine = true;
  } else {
    errors.push("engine_verdict_mismatch");
  }

  const algorithm = String(bundle.algorithm || "").toLowerCase();
  const signedPayload = bundle.signed_payload;
  if (signedPayload) {
    const expectedPayload = expectedSignedPayloadFromBundle(bundle);
    if (signedPayload !== expectedPayload) {
      checks.payload_binds = false;
      errors.push("signed_payload_mismatch");
    }
  }
  if (isEd25519Algorithm(algorithm)) {
    if (!bundle.public_key_pem || !bundle.signature || !signedPayload) {
      checks.signature = "invalid";
      errors.push("ed25519_fields_missing");
    } else {
      let sigOk = false;
      try {
        sigOk = verifyEd25519(signedPayload, bundle.signature, bundle.public_key_pem);
      } catch {
        sigOk = false;
      }
      checks.signature = sigOk ? "valid" : "invalid";
      if (!sigOk) errors.push("signature_mismatch");
    }
  } else if (algorithm.includes("hmac")) {
    checks.signature = "hmac_not_independently_verifiable";
  } else if (algorithm) {
    checks.signature = "unknown_algorithm";
    errors.push("unknown_algorithm");
  }

  const ok =
    checks.schema &&
    checks.engine_version &&
    checks.evidence_hash &&
    checks.engine &&
    checks.payload_binds &&
    (checks.signature === "valid" || checks.signature === "hmac_not_independently_verifiable");

  return {
    ok,
    independently_verifiable: checks.signature === "valid",
    checks,
    errors,
    replay,
    recorded_status: recorded || null,
    engine_version: engineVersion
  };
}

export function verifyAnchorAgainstChain(anchor, chainResult, { requireSignature = false } = {}) {
  const errors = [];
  if (!anchor || typeof anchor !== "object") {
    return { ok: false, errors: ["anchor_not_object"] };
  }
  if (anchor.schema && anchor.schema !== ANCHOR_SCHEMA) {
    errors.push("unknown_anchor_schema");
  }
  if (!chainResult?.valid) errors.push("chain_invalid");
  if (anchor.tip_row_hash && chainResult.tip_row_hash && anchor.tip_row_hash !== chainResult.tip_row_hash) {
    errors.push("anchor_tip_mismatch");
  }
  if (anchor.event_count != null && Number(anchor.event_count) !== Number(chainResult.total)) {
    errors.push("anchor_event_count_mismatch");
  }

  let signature = "skipped";
  const algorithm = String(anchor.algorithm || "").toLowerCase();
  const payload =
    anchor.signed_payload ||
    buildAnchorPayload({
      workspaceId: anchor.workspace_id,
      tipEventId: anchor.tip_event_id,
      tipRowHash: anchor.tip_row_hash,
      eventCount: anchor.event_count,
      anchoredAt: anchor.anchored_at
    });
  if (isEd25519Algorithm(algorithm)) {
    if (!anchor.public_key_pem || !anchor.signature) {
      signature = "invalid";
      errors.push("anchor_ed25519_fields_missing");
    } else {
      let sigOk = false;
      try {
        sigOk = verifyEd25519(payload, anchor.signature, anchor.public_key_pem);
      } catch {
        sigOk = false;
      }
      signature = sigOk ? "valid" : "invalid";
      if (!sigOk) errors.push("anchor_signature_mismatch");
    }
  } else if (algorithm.includes("hmac")) {
    signature = "hmac_not_independently_verifiable";
  } else if (requireSignature) {
    errors.push("anchor_signature_required");
  }

  const ok =
    errors.length === 0 &&
    (signature === "valid" || signature === "hmac_not_independently_verifiable" || signature === "skipped");
  return {
    ok,
    independently_verifiable: signature === "valid",
    signature,
    errors,
    external_kind: anchor.external_kind || "none",
    external_ref: anchor.external_ref || null
  };
}
