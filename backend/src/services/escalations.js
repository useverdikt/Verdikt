"use strict";

const crypto = require("crypto");
const { queryOne, queryAll, run } = require("../database");
const { nowIso, toIsoPlusMinutes } = require("../lib/time");
const { writeAudit } = require("./audit");
const { getWorkspacePolicy } = require("./workspaceConfig");
const { sendEscalationRequestedEmail, sendEscalationSlaReminderEmail } = require("./email");

const PENDING = "pending_human_review";
const RESOLVED = "resolved";

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
    `SELECT email FROM users WHERE workspace_id = ? AND role IN ('vp_engineering', 'cto', 'org_admin', 'release_manager')`,
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
  const existing = await queryOne(
    `SELECT * FROM escalation_requests WHERE workspace_id = ? AND release_id = ? AND state = ? ORDER BY created_at DESC LIMIT 1`,
    [workspaceId, releaseId, PENDING]
  );
  if (existing) {
    const now = nowIso();
    await run(
      `UPDATE escalation_requests SET reason = ?, blocking_signals_json = ?, attempted_fixes_json = ?,
       requested_by_type = ?, requested_by_name = ?, release_status = ?, updated_at = ? WHERE id = ?`,
      [
        reason.slice(0, 2000),
        JSON.stringify(blockingSignals),
        JSON.stringify(attemptedFixes),
        requestedByType,
        requestedByName,
        releaseStatus,
        now,
        existing.id
      ]
    );
    const refreshed = await queryOne("SELECT * FROM escalation_requests WHERE id = ?", [existing.id]);
    return { escalation: rowToEscalation(refreshed), reused: true };
  }

  const policy = await getWorkspacePolicy(workspaceId);
  const slaHours = Number.isFinite(Number(policy?.escalation_sla_hours))
    ? Math.max(1, Math.min(168, Number(policy.escalation_sla_hours)))
    : 24;
  const id = `esc_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
  const now = nowIso();
  const slaDue = toIsoPlusMinutes(slaHours * 60);

  await run(
    `INSERT INTO escalation_requests (
      id, workspace_id, release_id, state, reason, blocking_signals_json, attempted_fixes_json,
      requested_by_type, requested_by_name, release_status, created_at, updated_at, sla_due_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

  const row = await queryOne("SELECT * FROM escalation_requests WHERE id = ?", [id]);
  return { escalation: rowToEscalation(row), reused: false };
}

async function notifyEscalationCreated({ workspaceId, releaseId, escalation, releaseRow }) {
  const recipients = await resolveEscalationNotifyEmails(workspaceId);
  if (!recipients.length) return { skipped: true, reason: "no_recipients" };

  const release = releaseRow || (await queryOne("SELECT * FROM releases WHERE id = ?", [releaseId]));
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
    WHERE e.workspace_id = ?`;
  if (state && state !== "all") {
    sql += ` AND e.state = ?`;
    params.push(state);
  }
  sql += ` ORDER BY e.created_at DESC LIMIT ?`;
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

async function acknowledgeEscalation({ workspaceId, escalationId, actorEmail, note = "" }) {
  const row = await queryOne("SELECT * FROM escalation_requests WHERE id = ? AND workspace_id = ?", [
    escalationId,
    workspaceId
  ]);
  if (!row) return { ok: false, error: "not_found" };
  if (row.state !== PENDING) return { ok: false, error: "not_pending", state: row.state };

  const now = nowIso();
  await run(
    `UPDATE escalation_requests SET state = ?, acknowledged_at = ?, acknowledged_by = ?, updated_at = ? WHERE id = ?`,
    [RESOLVED, now, actorEmail || "user", now, escalationId]
  );

  await writeAudit({
    workspaceId,
    releaseId: row.release_id,
    eventType: "ESCALATION_ACKNOWLEDGED",
    actorType: "USER",
    actorName: actorEmail || "user",
    details: { escalation_id: escalationId, note: String(note || "").slice(0, 500) }
  });

  const updated = await queryOne("SELECT * FROM escalation_requests WHERE id = ?", [escalationId]);
  return { ok: true, escalation: rowToEscalation(updated) };
}

async function runEscalationSlaSweep() {
  const now = nowIso();
  const nowMs = Date.now();
  const pending = await queryAll(
    `SELECT e.*, r.version AS release_version FROM escalation_requests e
     LEFT JOIN releases r ON r.id = e.release_id
     WHERE e.state = ? AND e.sla_due_at IS NOT NULL AND TRIM(e.sla_due_at) != ''`,
    [PENDING]
  );

  for (const row of pending) {
    const dueMs = Date.parse(row.sla_due_at);
    if (!Number.isFinite(dueMs) || dueMs >= nowMs) continue;

    if (!row.sla_breached) {
      await run("UPDATE escalation_requests SET sla_breached = 1, updated_at = ? WHERE id = ?", [now, row.id]);
      await writeAudit({
        workspaceId: row.workspace_id,
        releaseId: row.release_id,
        eventType: "ESCALATION_SLA_BREACHED",
        actorType: "SYSTEM",
        actorName: "escalation_sla_sweep",
        details: { escalation_id: row.id, sla_due_at: row.sla_due_at }
      });
    }

    if (!row.sla_reminder_sent_at) {
      const recipients = await resolveEscalationNotifyEmails(row.workspace_id);
      if (recipients.length) {
        await sendEscalationSlaReminderEmail({
          to: recipients,
          workspaceId: row.workspace_id,
          releaseId: row.release_id,
          releaseVersion: row.release_version || row.release_id,
          escalationId: row.id,
          slaDueAt: row.sla_due_at
        });
      }
      await run("UPDATE escalation_requests SET sla_reminder_sent_at = ?, updated_at = ? WHERE id = ?", [
        now,
        now,
        row.id
      ]);
    }
  }
}

module.exports = {
  createEscalationRequest,
  notifyEscalationCreated,
  listEscalationsForWorkspace,
  acknowledgeEscalation,
  runEscalationSlaSweep,
  PENDING,
  RESOLVED
};
