"use strict";

const { queryAll, transaction } = require("../database");
const { writeAudit } = require("./audit");

const TAINTED_WINDOWS_SQL = `
  SELECT w.release_id
    FROM vcs_monitoring_windows w
   WHERE w.workspace_id = $1
     AND w.status = 'complete'
     AND w.inferred_outcome = 'HEALTHY'
     AND ($2::timestamptz IS NULL OR w.last_scanned_at::timestamptz >= $2::timestamptz)
     AND EXISTS (
       SELECT 1
         FROM production_observations po
        WHERE po.release_id = w.release_id
          AND po.workspace_id = w.workspace_id
          AND po.source = 'vcs_inference'
     )
   ORDER BY w.release_id
`;

async function listTaintedVcsHealthEvidence(
  workspaceId,
  { since = null, queryAllFn = queryAll } = {}
) {
  if (!workspaceId) throw new Error("workspaceId is required");
  const rows = await queryAllFn(TAINTED_WINDOWS_SQL, [workspaceId, since]);
  return rows.map((row) => row.release_id);
}

async function requeueTaintedVcsHealthEvidence(
  workspaceId,
  {
    since = null,
    actorName = "vcs_monitor_repair",
    transactionFn = transaction,
    writeAuditFn = writeAudit
  } = {}
) {
  if (!workspaceId) throw new Error("workspaceId is required");

  return transactionFn(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [workspaceId]);
    const windows = await tx.queryAll(`${TAINTED_WINDOWS_SQL} FOR UPDATE`, [
      workspaceId,
      since
    ]);
    const releaseIds = windows.map((row) => row.release_id);
    if (releaseIds.length === 0) {
      return {
        workspace_id: workspaceId,
        windows_requeued: 0,
        observations_removed: 0,
        alignments_invalidated: 0,
        adjustment_cache_invalidated: 0
      };
    }

    const observations = await tx.queryOne(
      `WITH removed AS (
         DELETE FROM production_observations
          WHERE workspace_id = $1
            AND source = 'vcs_inference'
            AND release_id = ANY($2::text[])
        RETURNING 1
       )
       SELECT COUNT(*)::int AS count FROM removed`,
      [workspaceId, releaseIds]
    );
    const alignments = await tx.queryOne(
      `WITH removed AS (
         DELETE FROM outcome_alignments
          WHERE workspace_id = $1
            AND release_id = ANY($2::text[])
        RETURNING 1
       )
       SELECT COUNT(*)::int AS count FROM removed`,
      [workspaceId, releaseIds]
    );
    const adjustmentCache = await tx.queryOne(
      `WITH removed AS (
         DELETE FROM production_adjustment_cache
          WHERE workspace_id = $1
        RETURNING 1
       )
       SELECT COUNT(*)::int AS count FROM removed`,
      [workspaceId]
    );
    await tx.run(
      `UPDATE vcs_monitoring_windows
          SET status = 'pending',
              last_scanned_at = NULL,
              findings_json = NULL,
              inferred_signals_json = NULL,
              inferred_outcome = NULL,
              error_message = NULL
        WHERE workspace_id = $1
          AND release_id = ANY($2::text[])`,
      [workspaceId, releaseIds]
    );
    await writeAuditFn({
      workspaceId,
      eventType: "VCS_MONITOR_EVIDENCE_REQUEUED",
      actorType: "SYSTEM",
      actorName,
      details: {
        reason: "provider_authentication_failure",
        since,
        windows_requeued: releaseIds.length,
        observations_removed: Number(observations?.count || 0),
        alignments_invalidated: Number(alignments?.count || 0),
        adjustment_cache_invalidated: Number(adjustmentCache?.count || 0)
      },
      tx
    });

    return {
      workspace_id: workspaceId,
      windows_requeued: releaseIds.length,
      observations_removed: Number(observations?.count || 0),
      alignments_invalidated: Number(alignments?.count || 0),
      adjustment_cache_invalidated: Number(adjustmentCache?.count || 0)
    };
  });
}

module.exports = {
  TAINTED_WINDOWS_SQL,
  listTaintedVcsHealthEvidence,
  requeueTaintedVcsHealthEvidence
};
