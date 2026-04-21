"use strict";

const { run } = require("../database");
const { nowIso } = require("../lib/time");
const { stampAuditRowHash } = require("./auditIntegrity");

async function writeAudit({
  workspaceId,
  releaseId = null,
  eventType,
  actorType,
  actorName,
  details = {}
}) {
  const createdAt = nowIso();
  const ins = await run(
    `INSERT INTO audit_events (workspace_id, release_id, event_type, actor_type, actor_name, details_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     RETURNING id`,
    [workspaceId, releaseId, eventType, actorType, actorName, JSON.stringify(details), createdAt]
  );
  const rowId = ins.lastInsertRowid;
  if (rowId != null) {
    try {
      await stampAuditRowHash(rowId);
    } catch {
      /* non-fatal */
    }
  }
}

module.exports = { writeAudit };
