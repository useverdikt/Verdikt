/**
 * Hash-chain helpers for audit exports. Must stay in sync with auditChain.cjs.
 */

import crypto from "node:crypto";

export const GENESIS = "GENESIS";
export const ANCHOR_SCHEMA = "verdikt.anchor.v1";

export function canonicalAuditPayload(row, prevHash = GENESIS) {
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

export function computeAuditRowHash(row, prevHash = GENESIS) {
  return crypto.createHash("sha256").update(canonicalAuditPayload(row, prevHash)).digest("hex");
}

export function normalizeExportEvent(event, expectedWorkspaceId = null) {
  const detailsJson =
    event.details_json != null
      ? event.details_json
      : event.details != null
        ? typeof event.details === "string"
          ? event.details
          : JSON.stringify(event.details)
        : null;
  const createdAt =
    event.created_at instanceof Date ? event.created_at.toISOString() : event.created_at;
  return {
    id: event.id,
    workspace_id: event.workspace_id || expectedWorkspaceId || null,
    release_id: event.release_id || null,
    event_type: event.event_type,
    actor_type: event.actor_type,
    actor_name: event.actor_name,
    details_json: detailsJson,
    created_at: createdAt,
    prev_hash: event.prev_hash,
    row_hash: event.row_hash
  };
}

export function verifyAuditExportChain(events, { expectedWorkspaceId = null } = {}) {
  const rows = Array.isArray(events)
    ? events.map((event) => normalizeExportEvent(event, expectedWorkspaceId))
    : [];
  const tampered = [];
  const broken_chain = [];
  const missing_hash = [];
  let expectedPrev = GENESIS;
  let ok = 0;
  for (const row of rows) {
    if (expectedWorkspaceId && row.workspace_id && row.workspace_id !== expectedWorkspaceId) {
      broken_chain.push({ id: row.id, reason: "workspace_mismatch" });
      continue;
    }
    if (!row.row_hash) {
      missing_hash.push({ id: row.id });
      continue;
    }
    if (row.prev_hash !== expectedPrev) {
      broken_chain.push({
        id: row.id,
        expected_prev: expectedPrev,
        actual_prev: row.prev_hash
      });
    }
    const recomputed = computeAuditRowHash(row, row.prev_hash || GENESIS);
    if (recomputed !== row.row_hash) {
      tampered.push({ id: row.id });
    } else {
      ok += 1;
    }
    expectedPrev = row.row_hash;
  }
  const valid = tampered.length === 0 && broken_chain.length === 0 && missing_hash.length === 0;
  const tip = rows.length ? rows[rows.length - 1] : null;
  return {
    valid,
    total: rows.length,
    ok,
    tampered,
    broken_chain,
    missing_hash,
    tip_row_hash: tip?.row_hash || GENESIS,
    tip_event_id: tip?.id || null
  };
}

export function buildAnchorPayload({ workspaceId, tipEventId, tipRowHash, eventCount, anchoredAt }) {
  const fields = {
    schema: ANCHOR_SCHEMA,
    workspace_id: workspaceId,
    tip_event_id: tipEventId,
    tip_row_hash: tipRowHash,
    event_count: eventCount,
    anchored_at: anchoredAt
  };
  return JSON.stringify(fields, Object.keys(fields).sort());
}
