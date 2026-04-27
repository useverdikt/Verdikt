"use strict";

/**
 * signalValidator.js
 * Schema validation for incoming signal payloads.
 */

const path = require("path");
const sharedPkg = require("../lib/sharedPkg");
const { queryAll, transaction } = require("../database");
const { nowIso } = require("../lib/time");

const KNOWN_SIGNAL_IDS = new Set([
  ...Object.keys(sharedPkg.signalAliasMap),
  ...Object.values(sharedPkg.signalAliasMap),
  ...(sharedPkg.aiSignalIds || [])
]);

function validateSignalPayload(rawSignals) {
  const accepted = {};
  const rejected = [];
  const warnings = [];

  if (!rawSignals || typeof rawSignals !== "object" || Array.isArray(rawSignals)) {
    return { valid: false, accepted, rejected: [{ key: null, reason: "payload must be a plain object" }], warnings };
  }

  for (const [rawKey, rawValue] of Object.entries(rawSignals)) {
    if (rawValue === null || rawValue === undefined) continue;

    if (typeof rawValue !== "number" || !Number.isFinite(rawValue)) {
      rejected.push({ key: rawKey, value: rawValue, reason: "value must be a finite number" });
      continue;
    }

    const normalised = sharedPkg.normaliseSignalKey
      ? sharedPkg.normaliseSignalKey(rawKey)
      : rawKey.toLowerCase().replace(/[^a-z0-9_]/g, "_");
    const mapped = sharedPkg.signalAliasMap[normalised];

    if (!mapped && !KNOWN_SIGNAL_IDS.has(normalised)) {
      warnings.push({
        key: rawKey,
        normalised,
        reason: "unrecognised_signal_name",
        hint: `'${rawKey}' did not match any known signal ID or alias. Check your pipeline signal names against the Verdikt signal schema.`
      });
      continue;
    }

    const finalId = mapped || normalised;
    accepted[finalId] = rawValue;
  }

  return {
    valid: rejected.length === 0,
    accepted,
    rejected,
    warnings
  };
}

const INSERT_SCHEMA_SQL = `
  INSERT INTO signal_schema (workspace_id, signal_id, aliases_json, required, created_at)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(workspace_id, signal_id) DO NOTHING
`;

async function ensureSignalSchema(workspaceId) {
  const existingRows = await queryAll("SELECT signal_id FROM signal_schema WHERE workspace_id = ?", [workspaceId]);
  const existing = new Set(existingRows.map((r) => r.signal_id));
  const now = nowIso();
  const toInsert = [...KNOWN_SIGNAL_IDS].filter((id) => !existing.has(id));
  if (!toInsert.length) return;

  await transaction(async (tx) => {
    for (const id of toInsert) {
      await tx.run(INSERT_SCHEMA_SQL, [workspaceId, id, "[]", 0, now]);
    }
  });
}

async function getSignalSchema(workspaceId) {
  await ensureSignalSchema(workspaceId);
  return queryAll("SELECT * FROM signal_schema WHERE workspace_id = ?", [workspaceId]);
}

module.exports = { validateSignalPayload, ensureSignalSchema, getSignalSchema };
