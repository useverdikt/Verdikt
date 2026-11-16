"use strict";

const { queryOne, transaction } = require("../database");
const { nowIso } = require("../lib/time");
const { writeAudit } = require("./audit");
const { isCertLikeStatus } = require("../lib/releaseStatus");
const { enqueuePostVerdictOutbox } = require("./outboundEffectOutbox");

function validateRevokeJustification(justification) {
  const text = String(justification || "").trim();
  if (text.length < 8) {
    return { ok: false, statusCode: 400, error: "justification is required (at least 8 characters)" };
  }
  return { ok: true, justification: text };
}

function revokeRejection(status) {
  if (String(status || "").toUpperCase() === "CERTIFICATION_REVOKED") {
    return { ok: false, statusCode: 400, error: "certification already revoked" };
  }
  if (!isCertLikeStatus(status)) {
    return { ok: false, statusCode: 400, error: "only certified releases can be revoked" };
  }
  return null;
}

/**
 * Human-only revocation. Frozen certification_snapshots are left untouched.
 * Gate action becomes `revoked`; ingest stays locked.
 */
async function revokeReleaseCertification(release, { actorName, actorRole, justification }) {
  if (!release?.id) return { ok: false, statusCode: 404, error: "release_not_found" };

  const validated = validateRevokeJustification(justification);
  if (!validated.ok) return validated;

  const staleRejection = revokeRejection(release.status);
  if (staleRejection) return staleRejection;

  const ts = nowIso();

  const committed = await transaction(async (tx) => {
    const locked = await tx.queryOne("SELECT status FROM releases WHERE id = $1 FOR UPDATE", [release.id]);
    if (!locked) return { ok: false, statusCode: 404, error: "release_not_found" };
    const rejection = revokeRejection(locked.status);
    if (rejection) return rejection;
    const priorStatus = locked.status;

    const snapshot = await tx.queryOne(
      "SELECT evidence_hash, frozen_at FROM certification_snapshots WHERE release_id = $1",
      [release.id]
    );

    await tx.run(
      `UPDATE releases
          SET status = $1,
              updated_at = $2
        WHERE id = $3`,
      ["CERTIFICATION_REVOKED", ts, release.id]
    );

    await writeAudit({
      workspaceId: release.workspace_id,
      releaseId: release.id,
      eventType: "CERTIFICATION_REVOKED",
      actorType: "USER",
      actorName: actorName || "user",
      details: {
        prior_status: priorStatus,
        justification: validated.justification,
        approver_role: actorRole || null,
        evidence_hash: snapshot?.evidence_hash || null,
        frozen_at: snapshot?.frozen_at || null
      },
      tx
    });

    await enqueuePostVerdictOutbox({
      tx,
      releaseId: release.id,
      workspaceId: release.workspace_id,
      verdictStatus: "CERTIFICATION_REVOKED",
      verdictIssuedAt: ts,
      triggerSource: "human_revoke",
      source: "revoke"
    });
    return { ok: true, priorStatus };
  });
  if (!committed.ok) return committed;

  const updated = await queryOne("SELECT * FROM releases WHERE id = $1", [release.id]);
  return {
    ok: true,
    release_id: release.id,
    status: updated?.status || "CERTIFICATION_REVOKED",
    prior_status: committed.priorStatus
  };
}

module.exports = {
  validateRevokeJustification,
  revokeReleaseCertification
};
