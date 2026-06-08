"use strict";

/**
 * Workspace-level configuration: threshold seeding, threshold map loading,
 * workspace policy. Uses PostgreSQL via the unified async DB API.
 */

const path = require("path");
const { queryOne, queryAll, run, transaction } = require("../database");
const sharedPkg = require("../lib/sharedPkg");
const { nowIso } = require("../lib/time");
const { ensureInboundWebhookSecret } = require("./inboundWebhookSecrets");

const workspaceSeedDone = new Set();
const defaultRequiredIds = new Set(sharedPkg.defaultRequiredSignalIds || []);

function normalizePolicyRow(row) {
  if (!row) return row;
  if (typeof row.require_ai_eval === "boolean") {
    return { ...row, require_ai_eval: row.require_ai_eval ? 1 : 0 };
  }
  return row;
}

function isDefaultRequiredSignal(signalId) {
  return defaultRequiredIds.has(String(signalId || ""));
}

async function ensureWorkspaceSeeded(workspaceId) {
  if (workspaceSeedDone.has(workspaceId)) return;
  await seedThresholds(workspaceId);
  await seedWorkspacePolicy(workspaceId);
  await ensureInboundWebhookSecret(workspaceId);
  workspaceSeedDone.add(workspaceId);
}

async function seedThresholds(workspaceId) {
  const row = await queryOne("SELECT COUNT(*) AS c FROM thresholds WHERE workspace_id = ?", [workspaceId]);
  const c = Number(row?.c ?? 0);
  if (c > 0) return;
  const defaults = sharedPkg.getDefaultThresholdSeedRows();
  const insertSql =
    "INSERT INTO thresholds (workspace_id, signal_id, min_value, max_value, required_for_certification) VALUES (?, ?, ?, ?, ?)";

  await transaction(async (tx) => {
    for (const row of defaults) {
      const required = isDefaultRequiredSignal(row[0]) ? 1 : 0;
      await tx.run(insertSql, [workspaceId, row[0], row[1], row[2], required]);
    }
  });
}

async function ensureMissingThresholdRows(workspaceId) {
  const defaults = sharedPkg.getDefaultThresholdSeedRows();
  const existingRows = await queryAll(
    "SELECT signal_id, min_value, max_value FROM thresholds WHERE workspace_id = ?",
    [workspaceId]
  );
  const existing = new Map(existingRows.map((r) => [r.signal_id, r]));
  const insertSql =
    "INSERT INTO thresholds (workspace_id, signal_id, min_value, max_value, required_for_certification) VALUES (?, ?, ?, ?, ?)";
  const updateSql =
    "UPDATE thresholds SET min_value = ?, max_value = ? WHERE workspace_id = ? AND signal_id = ?";

  await transaction(async (tx) => {
    for (const row of defaults) {
      const [signalId, min, max] = row;
      const cur = existing.get(signalId);
      const required = isDefaultRequiredSignal(signalId) ? 1 : 0;
      if (!cur) {
        await tx.run(insertSql, [workspaceId, signalId, min, max, required]);
        continue;
      }
      if (cur.min_value == null && cur.max_value == null && (min != null || max != null)) {
        await tx.run(updateSql, [min, max, workspaceId, signalId]);
      }
    }
  });
}

async function seedWorkspacePolicy(workspaceId) {
  const existing = await queryOne("SELECT workspace_id FROM workspace_policies WHERE workspace_id = ?", [
    workspaceId
  ]);
  if (existing) return;
  const now = nowIso();
  await run(
    `INSERT INTO workspace_policies (workspace_id, require_ai_eval, ai_missing_policy, created_at, updated_at)
     VALUES (?, 1, ?, ?::timestamptz, ?::timestamptz)`,
    [workspaceId, "block_uncertified", now, now]
  );
}

async function getThresholdMap(workspaceId) {
  await ensureWorkspaceSeeded(workspaceId);
  await ensureMissingThresholdRows(workspaceId);
  const rows = await queryAll(
    "SELECT signal_id, min_value, max_value, required_for_certification FROM thresholds WHERE workspace_id = ?",
    [workspaceId]
  );
  const map = {};
  for (const r of rows) {
    map[r.signal_id] = {
      ...sharedPkg.normalizeThresholdBounds(r.signal_id, r.min_value, r.max_value),
      required_for_certification: !!r.required_for_certification
    };
  }
  return map;
}

async function getWorkspacePolicy(workspaceId) {
  await ensureWorkspaceSeeded(workspaceId);
  const row = await queryOne("SELECT * FROM workspace_policies WHERE workspace_id = ?", [workspaceId]);
  return normalizePolicyRow(row);
}

module.exports = {
  ensureWorkspaceSeeded,
  getThresholdMap,
  getWorkspacePolicy
};
