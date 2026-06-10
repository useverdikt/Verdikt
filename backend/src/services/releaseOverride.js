"use strict";

const { queryOne, run } = require("../database");
const { nowIso } = require("../lib/time");
const { writeAudit } = require("./audit");
const { listReleaseDeltas } = require("./delta");
const {
  assessOverrideJustification,
  buildIntelligenceTrace,
  getReleaseIntelligence,
  upsertReleaseIntelligence
} = require("./domain");
const { signCertificationRecord } = require("./certSigner");

function validateOverridePayload({ justification, metadata = {} }) {
  if (!justification || !String(justification).trim()) {
    return { ok: false, statusCode: 400, error: "justification is required" };
  }
  const impactSummary = typeof metadata.impact_summary === "string" ? metadata.impact_summary.trim() : "";
  const mitigationPlan = typeof metadata.mitigation_plan === "string" ? metadata.mitigation_plan.trim() : "";
  const followUpDueDate =
    typeof metadata.follow_up_due_date === "string" ? metadata.follow_up_due_date.trim() : "";
  if (impactSummary.length < 8 || mitigationPlan.length < 8 || !/^\d{4}-\d{2}-\d{2}$/.test(followUpDueDate)) {
    return {
      ok: false,
      statusCode: 400,
      error: "metadata.impact_summary, metadata.mitigation_plan, and metadata.follow_up_due_date (YYYY-MM-DD) are required"
    };
  }
  return { ok: true, impactSummary, mitigationPlan, followUpDueDate };
}

/**
 * Apply a human override to an uncertified release. Shared by release override route and escalation inbox.
 */
async function applyReleaseOverride(
  release,
  { approver_type = "PERSON", approver_name, approver_role, justification, metadata = {} }
) {
  if (!release?.id) return { ok: false, statusCode: 404, error: "release_not_found" };

  const validated = validateOverridePayload({ justification, metadata });
  if (!validated.ok) return validated;

  if (release.status === "CERTIFIED") {
    return { ok: false, statusCode: 400, error: "override not needed for certified release" };
  }
  if (release.status === "CERTIFIED_WITH_OVERRIDE") {
    return {
      ok: false,
      statusCode: 400,
      error: "release already has an approved override; create a new release to change certification"
    };
  }

  const ts = nowIso();
  await run(
    `INSERT INTO override_history (release_id, approver_type, approver_name, approver_role, justification, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      release.id,
      approver_type.toUpperCase(),
      approver_name,
      approver_role,
      justification,
      JSON.stringify(metadata),
      ts
    ]
  );
  const existingOv = await queryOne("SELECT created_at FROM overrides WHERE release_id = ?", [release.id]);
  const overrideCreatedAt = existingOv?.created_at || ts;
  await run(
    `INSERT INTO overrides (release_id, approver_type, approver_name, approver_role, justification, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(release_id) DO UPDATE SET
       approver_type = excluded.approver_type,
       approver_name = excluded.approver_name,
       approver_role = excluded.approver_role,
       justification = excluded.justification,
       metadata_json = excluded.metadata_json,
       updated_at = excluded.updated_at`,
    [
      release.id,
      approver_type.toUpperCase(),
      approver_name,
      approver_role,
      justification,
      JSON.stringify(metadata),
      overrideCreatedAt,
      ts
    ]
  );

  await run("UPDATE releases SET status = ?, updated_at = ? WHERE id = ?", [
    "CERTIFIED_WITH_OVERRIDE",
    nowIso(),
    release.id
  ]);

  const deltaRowsForOverride = await listReleaseDeltas(release.id);
  const regression_signals = deltaRowsForOverride.filter((d) => !d.passed).map((d) => d.signal_id);

  const overrideAssessment = await assessOverrideJustification({
    justification,
    metadata,
    workspaceId: release.workspace_id,
    regression_signals
  });
  const overrideTrace = buildIntelligenceTrace({
    releaseId: release.id,
    workspaceId: release.workspace_id,
    releaseType: release.release_type,
    output: overrideAssessment
  });
  await upsertReleaseIntelligence(release.id, release.workspace_id, {
    override: overrideAssessment,
    trace: overrideTrace
  });

  await writeAudit({
    workspaceId: release.workspace_id,
    releaseId: release.id,
    eventType: "OVERRIDE_APPROVED",
    actorType: approver_type.toUpperCase(),
    actorName: approver_name,
    details: { approver_role, justification, metadata }
  });
  await writeAudit({
    workspaceId: release.workspace_id,
    releaseId: release.id,
    eventType: "OVERRIDE_JUSTIFICATION_ASSESSED",
    actorType: "SYSTEM",
    actorName: "assistive_intelligence",
    details: overrideAssessment
  });

  let overrideCertSig = null;
  try {
    const freshRelease = await queryOne("SELECT * FROM releases WHERE id = ?", [release.id]);
    if (freshRelease) {
      const intel = await getReleaseIntelligence(release.id);
      overrideCertSig = await signCertificationRecord(freshRelease, intel?.verdict);
    }
  } catch (_) {
    /* non-fatal */
  }

  return {
    ok: true,
    release_id: release.id,
    status: "CERTIFIED_WITH_OVERRIDE",
    assistive: { override_assessment: overrideAssessment },
    cert_signature: overrideCertSig
  };
}

module.exports = {
  applyReleaseOverride,
  validateOverridePayload
};
