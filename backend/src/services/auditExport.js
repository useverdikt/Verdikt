"use strict";

const { queryAll } = require("../database");
const { nowIso } = require("../lib/time");
const { verifyAuditIntegrity } = require("./auditIntegrity");

const EXPORT_VERSION = 1;
const PAGE_SIZE = 500;

function csvCell(value) {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function formatAuditExportCsv(events) {
  const header = [
    "id",
    "created_at",
    "event_type",
    "actor_type",
    "actor_name",
    "release_id",
    "agent_session_id",
    "prev_hash",
    "row_hash",
    "details_json"
  ];
  const lines = [header.join(",")];
  for (const event of events) {
    lines.push(
      [
        csvCell(event.id),
        csvCell(event.created_at),
        csvCell(event.event_type),
        csvCell(event.actor_type),
        csvCell(event.actor_name),
        csvCell(event.release_id),
        csvCell(event.agent_session_id),
        csvCell(event.prev_hash),
        csvCell(event.row_hash),
        csvCell(event.details_json)
      ].join(",")
    );
  }
  return `${lines.join("\n")}\n`;
}

async function listWorkspaceAuditEvents(workspaceId) {
  const events = [];
  let afterId = 0;
  for (;;) {
    const rows = await queryAll(
      `SELECT id, workspace_id, release_id, event_type, actor_type, actor_name,
              details_json, created_at, agent_session_id, prev_hash, row_hash
         FROM audit_events
        WHERE workspace_id = $1 AND id > $2
        ORDER BY id ASC
        LIMIT $3`,
      [workspaceId, afterId, PAGE_SIZE]
    );
    if (!rows.length) break;
    events.push(...rows);
    afterId = rows[rows.length - 1].id;
    if (rows.length < PAGE_SIZE) break;
  }
  return events;
}

function mapExportEvent(row) {
  let details = {};
  try {
    details = JSON.parse(row.details_json || "{}");
  } catch {
    details = {};
  }
  return {
    id: row.id,
    created_at: row.created_at,
    event_type: row.event_type,
    actor_type: row.actor_type,
    actor_name: row.actor_name,
    release_id: row.release_id,
    agent_session_id: row.agent_session_id || null,
    prev_hash: row.prev_hash,
    row_hash: row.row_hash,
    details,
    details_json: row.details_json
  };
}

async function buildWorkspaceAuditExport(workspaceId, format = "json") {
  const [events, integrity] = await Promise.all([
    listWorkspaceAuditEvents(workspaceId),
    verifyAuditIntegrity(workspaceId)
  ]);
  const exportedAt = nowIso();
  const mapped = events.map(mapExportEvent);
  const envelope = {
    export_version: EXPORT_VERSION,
    workspace_id: workspaceId,
    exported_at: exportedAt,
    event_count: mapped.length,
    integrity_at_export: {
      valid: integrity.valid === true,
      total: integrity.total,
      ok: integrity.ok,
      tampered: integrity.tampered?.length || 0,
      missing_hash: integrity.missing_hash?.length || 0,
      broken_chain: integrity.broken_chain?.length || 0
    }
  };

  if (String(format).toLowerCase() === "csv") {
    return {
      format: "csv",
      filename: `verdikt-audit-${workspaceId}-${exportedAt.slice(0, 10)}.csv`,
      body: formatAuditExportCsv(mapped),
      envelope
    };
  }

  return {
    format: "json",
    filename: `verdikt-audit-${workspaceId}-${exportedAt.slice(0, 10)}.json`,
    body: {
      ...envelope,
      events: mapped.map(({ details_json: _detailsJson, ...rest }) => rest)
    },
    envelope
  };
}

module.exports = {
  EXPORT_VERSION,
  csvCell,
  formatAuditExportCsv,
  listWorkspaceAuditEvents,
  buildWorkspaceAuditExport
};
