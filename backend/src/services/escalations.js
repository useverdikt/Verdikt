"use strict";

const crypto = require("crypto");
const { queryOne, queryAll, run, transaction } = require("../database");
const { nowIso, toIsoPlusMinutes } = require("../lib/time");
const { writeAudit } = require("./audit");
const { getWorkspacePolicy } = require("./workspaceConfig");
const { sendEscalationRequestedEmail, sendEscalationSlaReminderEmail } = require("./email");
const { applyReleaseOverride, runOverrideSideEffects } = require("./releaseOverride");
const {
  claimDueEscalations,
  completeEscalationSlaSweepClaim,
  ownsActiveEscalationSlaSweepClaim,
  recordEscalationSlaSweepClaimFailure,
  DEFAULT_LEASE_MS
} = require("./escalationSlaSweepClaims");
const { log, inc } = require("../lib/observability");
const { PENDING, RESOLVED } = require("./escalationResolution");

function parseJsonArray(raw) {
  try {
    const v = JSON.parse(raw || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function rowToEscalation(row) {
  if (!row) return null;
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    release_id: row.release_id,
    state: row.state,
    reason: row.reason,
    blocking_signals: parseJsonArray(row.blocking_signals_json),
    attempted_fixes: parseJsonArray(row.attempted_fixes_json),
    requested_by_type: row.requested_by_type,
    requested_by_name: row.requested_by_name,
    release_status: row.release_status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    acknowledged_at: row.acknowledged_at,
    acknowledged_by: row.acknowledged_by,
    sla_due_at: row.sla_due_at,
    sla_breached: !!row.sla_breached,
    sla_reminder_sent_at: row.sla_reminder_sent_at
  };
}

async function resolveEscalationNotifyEmails(workspaceId) {
  const policy = await getWorkspacePolicy(workspaceId);
  const configured = String(policy?.escalation_notify_email || "").trim();
  if (configured) {
    return configured
      .split(/[,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const envFallback = String(process.env.ESCALATION_NOTIFY_EMAIL || "").trim();
  if (envFallback) {
    return envFallback
      .split(/[,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  const approvers = await queryAll(
    `SELECT u.email FROM workspace_members wm
     JOIN users u ON u.id = wm.user_id
     WHERE wm.workspace_id = $1 AND wm.role IN ('vp_engineering', 'cto', 'org_admin', 'release_manager')`,
    [workspaceId]
  );
  return approvers.map((r) => String(r.email || "").trim()).filter(Boolean);
}

async function createEscalationRequest({
  workspaceId,
  releaseId,
  reason,
  blockingSignals = [],
  attemptedFixes = [],
  requestedByType,
  requestedByName,
  releaseStatus
}) {
  const policy = await getWorkspacePolicy(workspaceId);
  const slaHours = Number.isFinite(Number(policy?.escalation_sla_hours))
    ? Math.max(1, Math.min(168, Number(policy.escalation_sla_hours)))
    : 24;
  const id = `esc_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
  const now = nowIso();
  const slaDue = toIsoPlusMinutes(slaHours * 60);

  // One pending escalation per release (idx_escalations_one_pending_per_release);
  // a repeat escalate refreshes the pending row and keeps its id and SLA clock.
  const row = await queryOne(
    `INSERT INTO escalation_requests (
      id, workspace_id, release_id, state, reason, blocking_signals_json, attempted_fixes_json,
      requested_by_type, requested_by_name, release_status, created_at, updated_at, sla_due_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    ON CONFLICT (release_id) WHERE state = 'pending_human_review' DO UPDATE SET
      reason = EXCLUDED.reason,
      blocking_signals_json = EXCLUDED.blocking_signals_json,
      attempted_fixes_json = EXCLUDED.attempted_fixes_json,
      requested_by_type = EXCLUDED.requested_by_type,
      requested_by_name = EXCLUDED.requested_by_name,
      release_status = EXCLUDED.release_status,
      updated_at = EXCLUDED.updated_at
    RETURNING *, (xmax = 0) AS inserted`,
    [
      id,
      workspaceId,
      releaseId,
      PENDING,
      reason.slice(0, 2000),
      JSON.stringify(blockingSignals),
      JSON.stringify(attemptedFixes),
      requestedByType,
      requestedByName,
      releaseStatus,
      now,
      now,
      slaDue
    ]
  );
  return { escalation: rowToEscalation(row), reused: !row.inserted };
}

async function notifyEscalationCreated({ workspaceId, releaseId, escalation, releaseRow }) {
  const recipients = await resolveEscalationNotifyEmails(workspaceId);
  if (!recipients.length) return { skipped: true, reason: "no_recipients" };

  const release = releaseRow || (await queryOne("SELECT * FROM releases WHERE id = $1", [releaseId]));
  return sendEscalationRequestedEmail({
    to: recipients,
    workspaceId,
    releaseId,
    releaseVersion: release?.version || releaseId,
    prNumber: release?.pr_number ?? null,
    commitSha: release?.commit_sha || null,
    reason: escalation.reason,
    blockingSignals: escalation.blocking_signals,
    slaDueAt: escalation.sla_due_at
  });
}

async function listEscalationsForWorkspace(workspaceId, { state = PENDING, limit = 100 } = {}) {
  const lim = Math.min(200, Math.max(1, Number(limit) || 100));
  const params = [workspaceId];
  let sql = `SELECT e.*, r.version AS release_version, r.status AS current_release_status, r.pr_number, r.commit_sha
    FROM escalation_requests e
    LEFT JOIN releases r ON r.id = e.release_id
    WHERE e.workspace_id = $1`;
  if (state && state !== "all") {
    sql += ` AND e.state = $${params.length + 1}`;
    params.push(state);
  }
  sql += ` ORDER BY e.created_at DESC LIMIT $${params.length + 1}`;
  params.push(lim);

  const rows = await queryAll(sql, params);
  return rows.map((row) => ({
    ...rowToEscalation(row),
    release_version: row.release_version,
    current_release_status: row.current_release_status,
    pr_number: row.pr_number ?? null,
    commit_sha: row.commit_sha || null
  }));
}

/** PENDING → RESOLVED compare-and-set; false when another actor resolved it first. */
async function resolvePendingEscalation(tx, escalationId, workspaceId, actor, now) {
  const result = await tx.run(
    `UPDATE escalation_requests
        SET state = $1, acknowledged_at = $2, acknowledged_by = $3, updated_at = $2
      WHERE id = $4 AND workspace_id = $5 AND state = $6`,
    [RESOLVED, now, actor, escalationId, workspaceId, PENDING]
  );
  return result.changes === 1;
}

async function acknowledgeEscalation({ workspaceId, escalationId, actorEmail, note = "" }) {
  const row = await queryOne("SELECT * FROM escalation_requests WHERE id = $1 AND workspace_id = $2", [
    escalationId,
    workspaceId
  ]);
  if (!row) return { ok: false, error: "not_found" };
  if (row.state !== PENDING) return { ok: false, error: "not_pending", state: row.state };

  const now = nowIso();
  const transitioned = await transaction(async (tx) => {
    const won = await resolvePendingEscalation(tx, escalationId, workspaceId, actorEmail || "user", now);
    if (!won) return false;
    await writeAudit({
      workspaceId,
      releaseId: row.release_id,
      eventType: "ESCALATION_ACKNOWLEDGED",
      actorType: "USER",
      actorName: actorEmail || "user",
      details: { escalation_id: escalationId, note: String(note || "").slice(0, 500) },
      tx
    });
    return true;
  });
  if (!transitioned) return { ok: false, error: "not_pending", state: RESOLVED };

  const updated = await queryOne("SELECT * FROM escalation_requests WHERE id = $1", [escalationId]);
  return { ok: true, escalation: rowToEscalation(updated) };
}

async function acknowledgeEscalationWithOverride({
  workspaceId,
  escalationId,
  actorEmail,
  actorName,
  actorRole,
  note = "",
  justification,
  metadata = {}
}) {
  const row = await queryOne("SELECT * FROM escalation_requests WHERE id = $1 AND workspace_id = $2", [
    escalationId,
    workspaceId
  ]);
  if (!row) return { ok: false, error: "not_found" };
  if (row.state !== PENDING) return { ok: false, error: "not_pending", state: row.state };

  const release = await queryOne("SELECT * FROM releases WHERE id = $1 AND workspace_id = $2", [
    row.release_id,
    workspaceId
  ]);
  if (!release) return { ok: false, error: "release_not_found" };

  let overrideOut;
  try {
    await transaction(async (tx) => {
      const now = nowIso();
      const won = await resolvePendingEscalation(
        tx,
        escalationId,
        workspaceId,
        actorEmail || actorName || "user",
        now
      );
      if (!won) {
        const err = new Error("not_pending");
        err.statusCode = 409;
        throw err;
      }

      overrideOut = await applyReleaseOverride(
        release,
        {
          approver_type: "PERSON",
          approver_name: actorName || actorEmail || "user",
          approver_role: actorRole || null,
          justification,
          metadata
        },
        { tx, skipSideEffects: true }
      );
      if (!overrideOut.ok) {
        const err = new Error(overrideOut.error || "override_failed");
        err.statusCode = overrideOut.statusCode || 400;
        throw err;
      }

      await writeAudit({
        workspaceId,
        releaseId: row.release_id,
        eventType: "ESCALATION_ACKNOWLEDGED_WITH_OVERRIDE",
        actorType: "USER",
        actorName: actorEmail || actorName || "user",
        details: {
          escalation_id: escalationId,
          note: String(note || "").slice(0, 500),
          override_status: overrideOut.status
        },
        tx
      });
    });
  } catch (err) {
    return {
      ok: false,
      error: err.message || "override_failed",
      statusCode: err.statusCode || 400
    };
  }

  await runOverrideSideEffects(release, overrideOut.assistive?.override_assessment);

  const updated = await queryOne("SELECT * FROM escalation_requests WHERE id = $1", [escalationId]);
  return {
    ok: true,
    escalation: rowToEscalation(updated),
    override: overrideOut
  };
}

async function markEscalationBreachedWithAudit(
  row,
  now,
  { transactionFn = transaction, writeAuditFn = writeAudit } = {}
) {
  return transactionFn(async (tx) => {
    const transitioned = await tx.run(
      `UPDATE escalation_requests
          SET sla_breached = 1, updated_at = $1
        WHERE id = $2
          AND state = $3
          AND sla_breached = 0
        RETURNING id`,
      [now, row.id, PENDING]
    );
    if (transitioned.changes !== 1) return false;

    await writeAuditFn({
      workspaceId: row.workspace_id,
      releaseId: row.release_id,
      eventType: "ESCALATION_SLA_BREACHED",
      actorType: "SYSTEM",
      actorName: "escalation_sla_sweep",
      details: { escalation_id: row.id, sla_due_at: row.sla_due_at },
      tx
    });
    return true;
  });
}

async function markEscalationReminderSent(row, workerId, now, runFn = run) {
  return runFn(
    `UPDATE escalation_requests e
        SET sla_reminder_sent_at = $1, updated_at = $1
      WHERE e.id = $2
        AND e.state = $3
        AND e.sla_reminder_sent_at IS NULL
        AND EXISTS (
          SELECT 1
            FROM escalation_sla_sweep_claims c
           WHERE c.escalation_id = e.id
             AND c.claimed_by = $4
             AND c.lease_until > NOW()
        )`,
    [now, row.id, PENDING, workerId]
  );
}

async function runEscalationSlaSweep({
  limit = 100,
  workerId = `escalation-sla:${process.pid}`,
  leaseMs = DEFAULT_LEASE_MS,
  workspaceId = null,
  claimBatchFn = claimDueEscalations,
  completeClaimFn = completeEscalationSlaSweepClaim,
  ownsClaimFn = ownsActiveEscalationSlaSweepClaim,
  failClaimFn = recordEscalationSlaSweepClaimFailure,
  resolveRecipientsFn = resolveEscalationNotifyEmails,
  sendReminderFn = sendEscalationSlaReminderEmail,
  transactionFn = transaction,
  writeAuditFn = writeAudit,
  markReminderFn = markEscalationReminderSent,
  logFn = log,
  incFn = inc
} = {}) {
  const batchLimit = Math.min(500, Math.max(1, Number(limit) || 100));
  const dueRows = await claimBatchFn({
    limit: batchLimit,
    workerId,
    leaseMs,
    workspaceId
  });
  if (!dueRows.length) {
    return { processed: 0, breached: 0, reminders: 0, failed: 0 };
  }

  logFn("info", "escalation_sla_sweep_claimed", {
    workerId,
    escalationCount: dueRows.length,
    leaseMs: Number(leaseMs)
  });
  incFn("escalation_sla_sweep_claimed", dueRows.length);

  const recipientCache = new Map();
  const stats = { processed: dueRows.length, breached: 0, reminders: 0, failed: 0 };

  const recipientsFor = (workspace) => {
    if (!recipientCache.has(workspace)) {
      recipientCache.set(workspace, Promise.resolve(resolveRecipientsFn(workspace)));
    }
    return recipientCache.get(workspace);
  };

  await Promise.all(
    dueRows.map(async (row) => {
      try {
        if (!row.sla_breached) {
          const breached = await markEscalationBreachedWithAudit(row, nowIso(), {
            transactionFn,
            writeAuditFn
          });
          if (breached) {
            stats.breached += 1;
            incFn("escalation_sla_breach");
            logFn("warn", "escalation_sla_breach", {
              escalationId: row.id,
              workspaceId: row.workspace_id,
              releaseId: row.release_id,
              slaDueAt: row.sla_due_at
            });
          }
        }

        if (!row.sla_reminder_sent_at) {
          const ownsClaim = await ownsClaimFn(row.id, workerId);
          if (!ownsClaim) {
            logFn("error", "escalation_sla_sweep_ownership_lost", {
              escalationId: row.id,
              workerId
            });
            incFn("escalation_sla_sweep_ownership_lost");
            return;
          }
          const recipients = await recipientsFor(row.workspace_id);
          if (recipients.length) {
            const sent = await sendReminderFn({
              to: recipients,
              workspaceId: row.workspace_id,
              releaseId: row.release_id,
              releaseVersion: row.release_version || row.release_id,
              escalationId: row.id,
              slaDueAt: row.sla_due_at
            });
            // Email helpers report failure as { ok: false } instead of throwing; leave the
            // reminder unmarked so the claim fails and the next lease retries it.
            if (sent?.ok === false) {
              throw new Error(`escalation reminder email failed: ${String(sent.error || "unknown").slice(0, 200)}`);
            }
          }
          const marked = await markReminderFn(row, workerId, nowIso());
          if (marked.changes === 1) {
            stats.reminders += 1;
          } else {
            logFn("info", "escalation_sla_reminder_finalize_skipped", {
              escalationId: row.id,
              workerId
            });
            incFn("escalation_sla_reminder_finalize_skipped");
          }
        }

        try {
          const completed = await completeClaimFn(row.id, workerId);
          if (completed?.changes !== 1) {
            logFn("error", "escalation_sla_sweep_ownership_lost", {
              escalationId: row.id,
              workerId
            });
            incFn("escalation_sla_sweep_ownership_lost");
          }
        } catch (claimErr) {
          logFn("error", "escalation_sla_sweep_claim_complete_failed", {
            escalationId: row.id,
            workerId,
            error: String(claimErr?.message || claimErr).slice(0, 500)
          });
          incFn("escalation_sla_sweep_claim_complete_failed");
        }
      } catch (err) {
        stats.failed += 1;
        incFn("escalation_sla_sweep_failed");
        try {
          await failClaimFn(row.id, workerId, err);
        } catch (claimErr) {
          logFn("error", "escalation_sla_sweep_claim_failure_record_failed", {
            escalationId: row.id,
            workerId,
            error: String(claimErr?.message || claimErr).slice(0, 500)
          });
          incFn("escalation_sla_sweep_claim_failure_record_failed");
        }
        logFn("error", "escalation_sla_sweep_failed", {
          escalationId: row.id,
          workerId,
          error: String(err?.message || err).slice(0, 500)
        });
      }
    })
  );

  return stats;
}

module.exports = {
  createEscalationRequest,
  notifyEscalationCreated,
  listEscalationsForWorkspace,
  acknowledgeEscalation,
  acknowledgeEscalationWithOverride,
  markEscalationBreachedWithAudit,
  markEscalationReminderSent,
  runEscalationSlaSweep,
  PENDING,
  RESOLVED
};
