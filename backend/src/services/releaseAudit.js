"use strict";

const { queryAll } = require("../database");

function parseAuditRows(rows) {
  return (rows || []).map((e) => ({
    id: e.id,
    event_type: e.event_type,
    actor_type: e.actor_type,
    actor_name: e.actor_name,
    details: JSON.parse(e.details_json || "{}"),
    created_at: e.created_at
  }));
}

/** Paginated audit events for a single release. */
async function listReleaseAuditEvents(releaseId, { limit = 50, before = null } = {}) {
  const pageLimit = Math.min(200, Math.max(1, parseInt(String(limit), 10) || 50));
  const beforeId = before != null && String(before).trim() !== "" ? Number(before) : null;
  const params = [releaseId];
  let sql =
    "SELECT id, event_type, actor_type, actor_name, details_json, created_at FROM audit_events WHERE release_id = ?";
  if (Number.isFinite(beforeId)) {
    sql += " AND id < ?";
    params.push(beforeId);
  }
  sql += " ORDER BY id DESC LIMIT ?";
  params.push(pageLimit);

  const rows = await queryAll(sql, params);
  const events = parseAuditRows(rows);
  const next_before = events.length === pageLimit ? events[events.length - 1].id : null;
  return { events, next_before };
}

module.exports = { listReleaseAuditEvents, parseAuditRows };
