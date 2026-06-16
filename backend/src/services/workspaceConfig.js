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
const { ensureWorkspaceSignalDefinitions } = require("./signalDefinitions");

const workspaceSeedDone = new Set();
const defaultRequiredIds = new Set(sharedPkg.defaultRequiredSignalIds || []);

function normalizePolicyRow(row) {
  if (!row) return row;
  const out = { ...row };
  if (typeof out.require_ai_eval === "boolean") {
    out.require_ai_eval = out.require_ai_eval ? 1 : 0;
  }
  if (!out.gate_mode) out.gate_mode = "default";
  if (out.escalation_sla_hours == null) out.escalation_sla_hours = 24;
  return out;
}

function isDefaultRequiredSignal(signalId) {
  return defaultRequiredIds.has(String(signalId || ""));
}

async function ensureWorkspaceSeeded(workspaceId) {
  if (workspaceSeedDone.has(workspaceId)) return;
  await seedThresholds(workspaceId);
  await seedWorkspacePolicy(workspaceId);
  await ensureInboundWebhookSecret(workspaceId);
  await ensureWorkspaceSignalDefinitions(workspaceId);
  workspaceSeedDone.add(workspaceId);
}

async function seedThresholds(workspaceId) {
  const row = await queryOne("SELECT COUNT(*) AS c FROM thresholds WHERE workspace_id = ?", [workspaceId]);
  const c = Number(row?.c ?? 0);
  if (c > 0) return;
  // New workspaces start with no threshold rows — signals are added when adopted from the library or created custom.
}

async function ensureMissingThresholdRows(workspaceId) {
  const definitionRows = await queryAll(
    "SELECT signal_id FROM workspace_signal_definitions WHERE workspace_id = ? AND detached_at IS NULL",
    [workspaceId]
  ).catch(() => []);
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

  const seedRows =
    definitionRows.length > 0
      ? defaults.filter(([signalId]) => definitionRows.some((d) => d.signal_id === signalId))
      : [];

  await transaction(async (tx) => {
    for (const row of seedRows) {
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
  const [rows, defRows] = await Promise.all([
    queryAll(
      "SELECT signal_id, min_value, max_value, required_for_certification FROM thresholds WHERE workspace_id = ?",
      [workspaceId]
    ),
    queryAll(
      "SELECT signal_id, direction FROM workspace_signal_definitions WHERE workspace_id = ? AND detached_at IS NULL",
      [workspaceId]
    ).catch(() => [])
  ]);
  const directionBySignal = Object.fromEntries(
    (defRows || []).map((r) => [r.signal_id, r.direction || "min"])
  );
  const map = {};
  for (const r of rows) {
    const direction =
      directionBySignal[r.signal_id] || sharedPkg.getSignalThresholdDirection(r.signal_id);
    const normalized =
      direction === "max"
        ? {
            min: null,
            max: r.max_value != null ? r.max_value : r.min_value
          }
        : sharedPkg.normalizeThresholdBounds(r.signal_id, r.min_value, r.max_value);
    map[r.signal_id] = {
      ...normalized,
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
