"use strict";

const { queryOne, run } = require("../database");
const { nowIso } = require("../lib/time");

const DEFAULT_GITHUB_LABEL_NAME = "verdikt:rc";

function normalizeLabelName(value) {
  const label = String(value || "").trim();
  if (!label) return DEFAULT_GITHUB_LABEL_NAME;
  return label.slice(0, 120);
}

async function getGithubLabelTrigger(workspaceId) {
  const row = await queryOne(
    "SELECT workspace_id, label_name, enabled, created_at, updated_at FROM github_label_triggers WHERE workspace_id = $1",
    [workspaceId]
  );
  if (!row) {
    return {
      workspace_id: workspaceId,
      label_name: DEFAULT_GITHUB_LABEL_NAME,
      enabled: false
    };
  }
  return {
    workspace_id: row.workspace_id,
    label_name: normalizeLabelName(row.label_name),
    enabled: Number(row.enabled || 0) === 1,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

async function setGithubLabelTrigger(workspaceId, { label_name, enabled }) {
  const ts = nowIso();
  const label = normalizeLabelName(label_name);
  const enabledBit = enabled ? 1 : 0;
  await run(
    `INSERT INTO github_label_triggers (workspace_id, label_name, enabled, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT(workspace_id) DO UPDATE SET
       label_name = excluded.label_name,
       enabled = excluded.enabled,
       updated_at = excluded.updated_at`,
    [workspaceId, label, enabledBit, ts, ts]
  );
  return {
    workspace_id: workspaceId,
    label_name: label,
    enabled: enabledBit === 1,
    updated_at: ts
  };
}

async function deleteGithubLabelTrigger(workspaceId) {
  await run("DELETE FROM github_label_triggers WHERE workspace_id = $1", [workspaceId]);
}

module.exports = {
  DEFAULT_GITHUB_LABEL_NAME,
  getGithubLabelTrigger,
  setGithubLabelTrigger,
  deleteGithubLabelTrigger
};
