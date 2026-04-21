"use strict";

/**
 * auditIntegrity.js
 * Audit log immutability enforcement at the application layer.
 */

const crypto = require("crypto");
const { queryOne, queryAll, run } = require("../database");

function computeAuditRowHash(row) {
  const canonical = JSON.stringify({
    id: row.id,
    workspace_id: row.workspace_id,
    release_id: row.release_id || null,
    event_type: row.event_type,
    actor_type: row.actor_type,
    actor_name: row.actor_name,
    details_json: row.details_json || null,
    created_at: row.created_at
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

async function stampAuditRowHash(rowId) {
  const row = await queryOne("SELECT * FROM audit_events WHERE id = ?", [rowId]);
  if (!row) return null;
  const hash = computeAuditRowHash(row);
  await run("UPDATE audit_events SET row_hash = ? WHERE id = ?", [hash, rowId]);
  return hash;
}

async function verifyAuditIntegrity(workspaceId = null) {
  const rows = workspaceId
    ? await queryAll("SELECT * FROM audit_events WHERE workspace_id = ? ORDER BY id ASC", [workspaceId])
    : await queryAll("SELECT * FROM audit_events ORDER BY id ASC");

  let ok = 0;
  const tampered = [];

  for (const row of rows) {
    if (!row.row_hash) {
      const hash = computeAuditRowHash(row);
      await run("UPDATE audit_events SET row_hash = ? WHERE id = ? AND row_hash IS NULL", [hash, row.id]);
      ok++;
      continue;
    }
    const expected = computeAuditRowHash(row);
    if (expected === row.row_hash) {
      ok++;
    } else {
      tampered.push({
        id: row.id,
        workspace_id: row.workspace_id,
        release_id: row.release_id,
        event_type: row.event_type,
        created_at: row.created_at,
        reason: "hash_mismatch"
      });
    }
  }

  return { total: rows.length, ok, tampered };
}

module.exports = { stampAuditRowHash, verifyAuditIntegrity, computeAuditRowHash };
