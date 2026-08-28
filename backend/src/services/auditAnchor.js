"use strict";

const crypto = require("crypto");
const { queryOne, queryAll, run } = require("../database");
const { nowIso } = require("../lib/time");
const {
  CERT_SIGNING_KEY,
  CERT_ED25519_PRIVATE_KEY,
  CERT_ED25519_PUBLIC_KEY_PEM,
  AUDIT_ANCHOR_URL
} = require("../config");
const { postJsonWithTimeout } = require("../lib/outboundHttp");
const { log } = require("../lib/observability");
const { ANCHOR_SCHEMA, buildAnchorPayload } = require("@useverdikt/shared/auditChain");
const { signEd25519 } = require("@useverdikt/shared/independentVerify");

const SIGN_KEY = crypto.createHash("sha256").update(`verdikt:cert-sign:${CERT_SIGNING_KEY}`).digest();
const SIGNING_KEY_HINT = "hmac-sha256/verdikt-cert-signing-key-v2";
const ED25519_KEY_HINT = "ed25519/verdikt-cert-signing-key-v1";

function ed25519Configured() {
  return Boolean(CERT_ED25519_PRIVATE_KEY && CERT_ED25519_PUBLIC_KEY_PEM);
}

function signAnchorPayload(payload) {
  if (ed25519Configured()) {
    return {
      algorithm: "ed25519",
      public_key_hint: ED25519_KEY_HINT,
      public_key_pem: CERT_ED25519_PUBLIC_KEY_PEM,
      signature: signEd25519(payload, CERT_ED25519_PRIVATE_KEY)
    };
  }
  return {
    algorithm: "hmac-sha256",
    public_key_hint: SIGNING_KEY_HINT,
    public_key_pem: null,
    signature: crypto.createHmac("sha256", SIGN_KEY).update(payload).digest("hex")
  };
}

function toPublicAnchor(row, { workspaceSlug = null } = {}) {
  if (!row) return null;
  let proof = null;
  if (row.external_proof_json) {
    try {
      proof = typeof row.external_proof_json === "string" ? JSON.parse(row.external_proof_json) : row.external_proof_json;
    } catch {
      proof = null;
    }
  }
  return {
    schema: ANCHOR_SCHEMA,
    id: row.id,
    workspace_id: row.workspace_id,
    workspace_slug: workspaceSlug || null,
    tip_event_id: row.tip_event_id,
    tip_row_hash: row.tip_row_hash,
    event_count: Number(row.event_count),
    anchored_at: row.anchored_at,
    algorithm: row.algorithm,
    public_key_hint: row.public_key_hint || null,
    public_key_pem: row.public_key_pem || null,
    signature: row.signature,
    signed_payload: row.signed_payload,
    payload_hash: row.payload_hash,
    external_kind: row.external_kind || "none",
    external_ref: row.external_ref || null,
    external_proof: proof
  };
}

async function getLatestAnchorRow(workspaceId) {
  return queryOne(
    `SELECT * FROM audit_chain_anchors
      WHERE workspace_id = $1
      ORDER BY anchored_at DESC, id DESC
      LIMIT 1`,
    [workspaceId]
  );
}

async function getLatestPublicAnchor(workspaceId, { workspaceSlug = null } = {}) {
  const row = await getLatestAnchorRow(workspaceId);
  return toPublicAnchor(row, { workspaceSlug });
}

async function listWorkspaceChainTips() {
  return queryAll(
    `SELECT e.workspace_id,
            e.id AS tip_event_id,
            e.row_hash AS tip_row_hash,
            c.event_count
       FROM audit_events e
       INNER JOIN (
         SELECT workspace_id, MAX(id) AS max_id, COUNT(*)::int AS event_count
           FROM audit_events
          GROUP BY workspace_id
       ) c ON c.workspace_id = e.workspace_id AND c.max_id = e.id
      WHERE e.row_hash IS NOT NULL`
  );
}

async function postExternalAnchor(document) {
  if (!AUDIT_ANCHOR_URL) {
    return { kind: "none", ref: null, proof: null };
  }
  const res = await postJsonWithTimeout(AUDIT_ANCHOR_URL, document, { timeoutMs: 8_000 });
  if (!res.ok) {
    log("warn", "audit_anchor_external_failed", { status: res.status });
    return { kind: "none", ref: null, proof: null };
  }
  let body = null;
  try {
    const text = await res.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = { raw: text.slice(0, 2000) };
      }
    }
  } catch {
    body = { status: res.status };
  }
  const ref =
    (body && typeof body === "object" && (body.id || body.receipt_id || body.url)) || AUDIT_ANCHOR_URL;
  return { kind: "https", ref: String(ref).slice(0, 500), proof: body };
}

async function persistAnchor({
  workspaceId,
  tipEventId,
  tipRowHash,
  eventCount,
  signedPayload,
  signed,
  payloadHash,
  anchoredAt,
  external
}) {
  const id = `aca_${crypto.randomUUID().replace(/-/g, "")}`;
  await run(
    `INSERT INTO audit_chain_anchors
       (id, workspace_id, tip_event_id, tip_row_hash, event_count, anchored_at,
        algorithm, payload_hash, signature, signed_payload, public_key_hint, public_key_pem,
        external_kind, external_ref, external_proof_json)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      id,
      workspaceId,
      tipEventId,
      tipRowHash,
      eventCount,
      anchoredAt,
      signed.algorithm,
      payloadHash,
      signed.signature,
      signedPayload,
      signed.public_key_hint,
      signed.public_key_pem,
      external.kind,
      external.ref,
      external.proof != null ? JSON.stringify(external.proof) : null
    ]
  );
  return getLatestAnchorRow(workspaceId);
}

/**
 * Sign and store a chain-tip witness. Does not write audit_events (that would move the tip).
 * Optional AUDIT_ANCHOR_URL is one POST, no retry.
 */
async function anchorWorkspaceTip(tip) {
  if (!tip?.workspace_id || !tip.tip_row_hash) return { skipped: true, reason: "missing_tip" };
  const existing = await getLatestAnchorRow(tip.workspace_id);
  if (existing && Number(existing.tip_event_id) === Number(tip.tip_event_id)) {
    return { skipped: true, reason: "tip_unchanged" };
  }
  const anchoredAt = nowIso();
  const signedPayload = buildAnchorPayload({
    workspaceId: tip.workspace_id,
    tipEventId: tip.tip_event_id,
    tipRowHash: tip.tip_row_hash,
    eventCount: tip.event_count,
    anchoredAt
  });
  const signed = signAnchorPayload(signedPayload);
  const payloadHash = crypto.createHash("sha256").update(signedPayload).digest("hex");
  const document = {
    schema: ANCHOR_SCHEMA,
    workspace_id: tip.workspace_id,
    tip_event_id: tip.tip_event_id,
    tip_row_hash: tip.tip_row_hash,
    event_count: tip.event_count,
    anchored_at: anchoredAt,
    algorithm: signed.algorithm,
    public_key_hint: signed.public_key_hint,
    public_key_pem: signed.public_key_pem,
    signature: signed.signature,
    signed_payload: signedPayload,
    payload_hash: payloadHash
  };
  let external = { kind: "none", ref: null, proof: null };
  try {
    external = await postExternalAnchor(document);
  } catch (err) {
    log("warn", "audit_anchor_external_unhandled", { error: String(err?.message || err).slice(0, 300) });
  }
  const row = await persistAnchor({
    workspaceId: tip.workspace_id,
    tipEventId: tip.tip_event_id,
    tipRowHash: tip.tip_row_hash,
    eventCount: tip.event_count,
    signedPayload,
    signed,
    payloadHash,
    anchoredAt,
    external
  });
  return { skipped: false, anchor: toPublicAnchor(row) };
}

async function runAuditAnchorSweep() {
  const tips = await listWorkspaceChainTips();
  let anchored = 0;
  let skipped = 0;
  for (const tip of tips) {
    const result = await anchorWorkspaceTip(tip);
    if (result.skipped) skipped += 1;
    else anchored += 1;
  }
  if (anchored > 0) {
    log("info", "audit_anchor_sweep", { anchored, skipped, workspaces: tips.length });
  }
  return { anchored, skipped, workspaces: tips.length };
}

module.exports = {
  ANCHOR_SCHEMA,
  toPublicAnchor,
  getLatestAnchorRow,
  getLatestPublicAnchor,
  listWorkspaceChainTips,
  anchorWorkspaceTip,
  runAuditAnchorSweep,
  signAnchorPayload
};
