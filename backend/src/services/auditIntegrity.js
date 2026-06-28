"use strict";

/**
 * auditIntegrity.js
 * Append-only audit log with per-workspace hash chain.
 */

const crypto = require("crypto");
const { queryOne, queryAll, transaction } = require("../database");

const GENESIS = "GENESIS";

function canonicalAuditPayload(row, prevHash = GENESIS) {
  return JSON.stringify({
    workspace_id: row.workspace_id,
    release_id: row.release_id || null,
    event_type: row.event_type,
    actor_type: row.actor_type,
    actor_name: row.actor_name,
    details_json: row.details_json || null,
    created_at: row.created_at,
    prev_hash: prevHash
  });
}

function computeAuditRowHash(row, prevHash = GENESIS) {
  return crypto.createHash("sha256").update(canonicalAuditPayload(row, prevHash)).digest("hex");
}

/**
 * Compute chain fields for a new audit row before INSERT.
 *
 * Pass a transaction client (`tx`) so the advisory lock and the subsequent
 * INSERT share the same transaction — preventing concurrent writers from
 * forking the hash chain even when no prior rows exist (genesis case).
 *
 * pg_advisory_xact_lock(hashtext(workspace_id)) serialises all concurrent
 * audit writes for a given workspace within the transaction.  SELECT FOR
 * UPDATE alone is insufficient when the table has no rows yet.
 *
 * When `tx` is omitted a standalone transaction is opened internally.
 */
async function computeAuditChainFields(workspaceId, row, tx = null) {
  const doCompute = async (client) => {
    // Acquire an exclusive advisory lock scoped to this workspace for the
    // duration of the transaction, serialising concurrent writers.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [workspaceId]);
    const last = await client.queryOne(
      `SELECT row_hash FROM audit_events
       WHERE workspace_id = $1 AND row_hash IS NOT NULL
       ORDER BY id DESC LIMIT 1`,
      [workspaceId]
    );
    const prevHash = last?.row_hash || GENESIS;
    const rowHash = computeAuditRowHash(row, prevHash);
    return { prev_hash: prevHash, row_hash: rowHash };
  };

  if (tx) return doCompute(tx);

  let result;
  await transaction(async (innerTx) => {
    result = await doCompute(innerTx);
  });
  return result;
}

/**
 * Read-only integrity verification. Never mutates rows.
 */
async function verifyAuditIntegrity(workspaceId = null) {
  const rows = workspaceId
    ? await queryAll("SELECT * FROM audit_events WHERE workspace_id = $1 ORDER BY id ASC", [workspaceId])
    : await queryAll("SELECT * FROM audit_events ORDER BY workspace_id ASC, id ASC");

  let ok = 0;
  const tampered = [];
  const missing_hash = [];
  const broken_chain = [];
  let expectedPrev = GENESIS;
  let currentWorkspace = null;

  for (const row of rows) {
    if (workspaceId == null && row.workspace_id !== currentWorkspace) {
      currentWorkspace = row.workspace_id;
      expectedPrev = GENESIS;
    }

    if (!row.row_hash) {
      missing_hash.push({
        id: row.id,
        workspace_id: row.workspace_id,
        event_type: row.event_type,
        created_at: row.created_at,
        reason: "missing_row_hash"
      });
      expectedPrev = row.row_hash || expectedPrev;
      continue;
    }

    const rowPrev = row.prev_hash || GENESIS;
    if (rowPrev !== expectedPrev) {
      broken_chain.push({
        id: row.id,
        workspace_id: row.workspace_id,
        event_type: row.event_type,
        created_at: row.created_at,
        expected_prev_hash: expectedPrev,
        actual_prev_hash: rowPrev,
        reason: "chain_break"
      });
    }

    const expectedHash = computeAuditRowHash(row, rowPrev);
    if (expectedHash !== row.row_hash) {
      tampered.push({
        id: row.id,
        workspace_id: row.workspace_id,
        release_id: row.release_id,
        event_type: row.event_type,
        created_at: row.created_at,
        reason: "hash_mismatch"
      });
    } else {
      ok++;
    }

    expectedPrev = row.row_hash;
  }

  return {
    total: rows.length,
    ok,
    tampered,
    missing_hash,
    broken_chain,
    valid: tampered.length === 0 && missing_hash.length === 0 && broken_chain.length === 0
  };
}

/** @deprecated use computeAuditChainFields at insert time */
async function stampAuditRowHash(_rowId) {
  return null;
}

module.exports = {
  GENESIS,
  computeAuditRowHash,
  computeAuditChainFields,
  verifyAuditIntegrity,
  stampAuditRowHash,
  canonicalAuditPayload
};
