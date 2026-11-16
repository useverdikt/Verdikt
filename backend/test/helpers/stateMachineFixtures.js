"use strict";

/**
 * Fixtures for state-machine regression tests (docs/STATE_MACHINES.md).
 * Requires the database env to be configured by the caller before import.
 */

const crypto = require("crypto");
const { run, queryOne } = require("../../src/database");
const { getPool } = require("../../src/db/pg");
const { ensureWorkspaceSeeded } = require("../../src/services/domain");
const { adoptLibrarySignal } = require("../../src/services/signalDefinitions");
const { nowIso } = require("../../src/lib/time");

function rid(prefix) {
  return `${prefix}_${crypto.randomBytes(5).toString("hex")}`;
}

/** Workspace whose only gating signals are `accuracy` and `safety`, both required with min 50. */
async function seedWorkspaceWithRequiredSignals() {
  const wsId = rid("ws_sm");
  await ensureWorkspaceSeeded(wsId);
  for (const signalId of ["accuracy", "safety"]) {
    await adoptLibrarySignal(wsId, signalId, {
      threshold: { min: 50, max: null },
      required_for_certification: 1
    });
  }
  return wsId;
}

async function insertRelease(
  wsId,
  { status = "COLLECTING", deadlineOffsetMs = 30 * 60_000, environment = "staging", verdictIssued = false } = {}
) {
  const releaseId = rid("rel_sm");
  const ts = nowIso();
  await run(
    `INSERT INTO releases (id, workspace_id, version, release_type, environment, status, created_at, updated_at, collection_deadline, verdict_issued_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9)`,
    [
      releaseId,
      wsId,
      `v-${releaseId}`,
      "model_update",
      environment,
      status,
      ts,
      new Date(Date.now() + deadlineOffsetMs).toISOString(),
      verdictIssued ? ts : null
    ]
  );
  return queryOne("SELECT * FROM releases WHERE id = $1", [releaseId]);
}

async function insertSignal(releaseId, signalId, value) {
  await run(
    "INSERT INTO signals (release_id, signal_id, value, source, created_at) VALUES ($1, $2, $3, $4, $5)",
    [releaseId, signalId, value, "test", nowIso()]
  );
}

async function auditCount(releaseId, eventType) {
  const row = await queryOne(
    "SELECT COUNT(*) AS c FROM audit_events WHERE release_id = $1 AND event_type = $2",
    [releaseId, eventType]
  );
  return Number(row?.c || 0);
}

async function waitForLockWaiter(timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const row = await queryOne(
      `SELECT COUNT(*) AS c FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND datname = current_database()`
    );
    if (Number(row?.c || 0) > 0) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return false;
}

/**
 * Deterministically reproduce "another writer committed between my read and my
 * write": lock a row in a separate transaction, apply `mutate`, start `fn`, wait
 * until `fn` blocks on that lock, then commit and return `fn`'s result.
 */
async function interleaveWithHeldRowLock({ lockSql, lockParams }, mutate, fn) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query(lockSql, lockParams);
    await mutate(client);
    const pending = fn();
    const blocked = await waitForLockWaiter();
    await client.query("COMMIT");
    const result = await pending;
    return { result, blocked };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  rid,
  seedWorkspaceWithRequiredSignals,
  insertRelease,
  insertSignal,
  auditCount,
  interleaveWithHeldRowLock
};
