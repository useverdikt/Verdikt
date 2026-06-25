"use strict";

const crypto = require("crypto");
const { queryAll, run } = require("../database");
const { nowIso } = require("../lib/time");

function mapRow(row) {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    source_name: row.source_name,
    notes: row.notes || null,
    status: row.status || "pending",
    created_at: row.created_at,
    created_by_email: row.created_by_email || null
  };
}

async function listIntegrationRequests(workspaceId) {
  const rows = await queryAll(
    `SELECT id, workspace_id, source_name, notes, status, created_at, created_by_email
     FROM integration_requests
     WHERE workspace_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [workspaceId]
  );
  return rows.map(mapRow);
}

async function createIntegrationRequest(workspaceId, input, actorEmail) {
  const sourceName = String(input?.source_name || "").trim();
  if (!sourceName || sourceName.length > 120) {
    throw new Error("source_name is required (max 120 characters)");
  }
  const notes = input?.notes ? String(input.notes).trim().slice(0, 2000) : null;
  const id = `intreq_${crypto.randomBytes(8).toString("hex")}`;
  const now = nowIso();
  await run(
    `INSERT INTO integration_requests
      (id, workspace_id, source_name, notes, status, created_at, created_by_email)
     VALUES ($1, $2, $3, $4, 'pending', $5, $6)`,
    [id, workspaceId, sourceName, notes, now, actorEmail || null]
  );
  return mapRow({
    id,
    workspace_id: workspaceId,
    source_name: sourceName,
    notes,
    status: "pending",
    created_at: now,
    created_by_email: actorEmail || null
  });
}

module.exports = { listIntegrationRequests, createIntegrationRequest };
