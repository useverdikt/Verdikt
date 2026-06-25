"use strict";

const crypto = require("crypto");
const { queryOne, queryAll, run, transaction } = require("../database");
const { nowIso } = require("../lib/time");
const sharedPkg = require("../lib/sharedPkg");

const globalCatalogSeeded = { done: false };

function humanizeSignalId(signalId) {
  return String(signalId || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function inferUnit(signalId, direction) {
  const id = String(signalId || "");
  if (sharedPkg.aiSignalIds?.includes(id)) return "%";
  if (id.includes("latency")) return "ms";
  if (id.includes("rate") && direction === "max") return "%";
  if (id === "fps") return "fps";
  if (id === "startup" || id === "screenload" || id === "recovery") return "s";
  return "";
}

/** Whether a threshold row should gate certification (adopted signal or its delta). */
function isSignalAdoptedForGating(signalId, adoptedSignalIds) {
  const id = String(signalId || "");
  if (!id) return false;
  if (adoptedSignalIds.has(id)) return true;
  if (id.endsWith("_delta")) {
    return adoptedSignalIds.has(id.slice(0, -"_delta".length));
  }
  return false;
}

function filterThresholdMapForAdopted(thresholdMap, adoptedSignalIds) {
  const out = {};
  for (const [signalId, cfg] of Object.entries(thresholdMap || {})) {
    if (isSignalAdoptedForGating(signalId, adoptedSignalIds)) {
      out[signalId] = cfg;
    }
  }
  return out;
}

async function getStoredThresholdRow(workspaceId, signalId) {
  const row = await queryOne(
    "SELECT min_value, max_value, required_for_certification FROM thresholds WHERE workspace_id = $1 AND signal_id = $2",
    [workspaceId, signalId]
  );
  if (!row) return null;
  return {
    min: row.min_value,
    max: row.max_value,
    required_for_certification: !!row.required_for_certification
  };
}

function buildLibrarySeedRows() {
  const rows = [];
  const defs = sharedPkg.aiSignalDefinitions || {};
  const directions = sharedPkg.signalThresholdDirections || {};
  const defaults = sharedPkg.defaultThresholds || {};
  const now = nowIso();

  for (const [signalId, meta] of Object.entries(defs)) {
    const direction = directions[signalId] || meta.direction || "min";
    const suggested =
      defaults[signalId] != null
        ? direction === "max"
          ? { max: defaults[signalId] }
          : { min: defaults[signalId] }
        : null;
    rows.push({
      signal_id: signalId,
      display_name: meta.label || humanizeSignalId(signalId),
      description: meta.description || null,
      direction,
      unit: inferUnit(signalId, direction),
      suggested_threshold_json: suggested ? JSON.stringify(suggested) : null,
      source_hints_json: JSON.stringify(["braintrust", "langsmith"]),
      category: "ai_quality",
      created_at: now
    });
  }

  const extraSignals = Object.keys(defaults).filter((id) => !defs[id] && !id.endsWith("_delta"));
  for (const signalId of extraSignals) {
    const direction = directions[signalId] || "min";
    const suggested =
      defaults[signalId] != null
        ? direction === "max"
          ? { max: defaults[signalId] }
          : { min: defaults[signalId] }
        : null;
    let category = "performance";
    if (["smoke", "e2e_regression"].includes(signalId)) category = "delivery";
    if (signalId.startsWith("manual_qa")) category = "manual_qa";
    if (["crashrate", "anrrate", "errorrate", "oomrate"].includes(signalId)) category = "reliability";
    rows.push({
      signal_id: signalId,
      display_name: humanizeSignalId(signalId),
      description: null,
      direction,
      unit: inferUnit(signalId, direction),
      suggested_threshold_json: suggested ? JSON.stringify(suggested) : null,
      source_hints_json: JSON.stringify([]),
      category,
      created_at: now
    });
  }

  return rows;
}

function buildConnectorSeedRows() {
  const sourceMap = sharedPkg.signalSourceMap || {};
  const directions = sharedPkg.signalThresholdDirections || {};
  const rows = [];
  for (const [sourceId, signalIds] of Object.entries(sourceMap)) {
    for (const signalId of signalIds) {
      rows.push({
        source_id: sourceId,
        signal_id: signalId,
        display_name: humanizeSignalId(signalId),
        direction: directions[signalId] || "min",
        ingest_mode: sourceId === "manual_qa" ? "push" : "pull"
      });
    }
  }
  // Partner push connector (ZizkaDB)
  for (const entry of [
    {
      source_id: "zizkadb",
      signal_id: "behavioural_drift",
      display_name: "Behavioural Drift",
      direction: "max",
      ingest_mode: "push"
    },
    {
      source_id: "zizkadb",
      signal_id: "session_anomaly_rate",
      display_name: "Session Anomaly Rate",
      direction: "max",
      ingest_mode: "push"
    }
  ]) {
    rows.push(entry);
  }
  rows.push({
    source_id: "custom",
    signal_id: "*",
    display_name: "Custom signals",
    direction: "min",
    ingest_mode: "push"
  });
  return rows;
}

async function ensureGlobalCatalogSeeded() {
  if (globalCatalogSeeded.done) return;
  const libCount = await queryOne("SELECT COUNT(*) AS c FROM signal_library");
  if (Number(libCount?.c || 0) === 0) {
    const insertLib =
      "INSERT INTO signal_library (signal_id, display_name, description, direction, unit, suggested_threshold_json, source_hints_json, category, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)";
    for (const row of buildLibrarySeedRows()) {
      await run(insertLib, [
        row.signal_id,
        row.display_name,
        row.description,
        row.direction,
        row.unit,
        row.suggested_threshold_json,
        row.source_hints_json,
        row.category,
        row.created_at
      ]);
    }
  }

  const insertConn =
    "INSERT INTO connector_signal_map (source_id, signal_id, display_name, direction, ingest_mode) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (source_id, signal_id) DO NOTHING";
  for (const row of buildConnectorSeedRows()) {
    if (row.signal_id === "*") continue;
    await run(insertConn, [
      row.source_id,
      row.signal_id,
      row.display_name,
      row.direction,
      row.ingest_mode
    ]);
  }

  globalCatalogSeeded.done = true;
}

function mapDefinitionRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    signal_id: row.signal_id,
    display_name: row.display_name || humanizeSignalId(row.signal_id),
    description: row.description || null,
    direction: row.direction || "min",
    unit: row.unit || "",
    source_id: row.source_id || null,
    from_library: Boolean(row.from_library),
    created_at: row.created_at
  };
}

function mapLibraryRow(row) {
  if (!row) return null;
  let suggested_threshold = null;
  try {
    suggested_threshold = row.suggested_threshold_json
      ? JSON.parse(row.suggested_threshold_json)
      : null;
  } catch (_) {
    suggested_threshold = null;
  }
  let source_hints = [];
  try {
    source_hints = row.source_hints_json ? JSON.parse(row.source_hints_json) : [];
  } catch (_) {
    source_hints = [];
  }
  return {
    signal_id: row.signal_id,
    display_name: row.display_name,
    description: row.description || null,
    direction: row.direction || "min",
    unit: row.unit || "",
    suggested_threshold,
    source_hints,
    category: row.category || null
  };
}

async function getLibraryEntry(signalId) {
  await ensureGlobalCatalogSeeded();
  const row = await queryOne("SELECT * FROM signal_library WHERE signal_id = $1", [signalId]);
  return row ? mapLibraryRow(row) : null;
}

async function listLibraryEntries() {
  await ensureGlobalCatalogSeeded();
  const rows = await queryAll("SELECT * FROM signal_library ORDER BY category, signal_id");
  return rows.map(mapLibraryRow);
}

async function listConnectorSignals() {
  await ensureGlobalCatalogSeeded();
  const rows = await queryAll(
    "SELECT * FROM connector_signal_map WHERE signal_id != '*' ORDER BY source_id, signal_id"
  );
  return rows.map((row) => ({
    source_id: row.source_id,
    signal_id: row.signal_id,
    display_name: row.display_name || humanizeSignalId(row.signal_id),
    direction: row.direction || "min",
    ingest_mode: row.ingest_mode || "pull"
  }));
}

async function listWorkspaceDefinitions(workspaceId) {
  await ensureWorkspaceSignalDefinitions(workspaceId);
  const rows = await queryAll(
    "SELECT * FROM workspace_signal_definitions WHERE workspace_id = $1 AND detached_at IS NULL ORDER BY signal_id",
    [workspaceId]
  );
  return rows.map(mapDefinitionRow);
}

async function getWorkspaceDefinition(workspaceId, signalId) {
  const row = await queryOne(
    "SELECT * FROM workspace_signal_definitions WHERE workspace_id = $1 AND signal_id = $2 AND detached_at IS NULL",
    [workspaceId, signalId]
  );
  return mapDefinitionRow(row);
}

function normalizeSignalId(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

async function upsertThresholdForDefinition(workspaceId, signalId, { min, max, required_for_certification } = {}) {
  const required = required_for_certification ? 1 : 0;
  await run(
    `INSERT INTO thresholds (workspace_id, signal_id, min_value, max_value, required_for_certification)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (workspace_id, signal_id) DO UPDATE SET
       min_value = COALESCE(excluded.min_value, thresholds.min_value),
       max_value = COALESCE(excluded.max_value, thresholds.max_value),
       required_for_certification = excluded.required_for_certification`,
    [workspaceId, signalId, min ?? null, max ?? null, required]
  );
}

async function createWorkspaceDefinition(workspaceId, input, opts = {}) {
  await ensureGlobalCatalogSeeded();
  const signalId = normalizeSignalId(input.signal_id);
  if (!signalId) throw new Error("signal_id is required");

  const existing = await getWorkspaceDefinition(workspaceId, signalId);
  if (existing) return existing;

  const library = input.from_library ? await getLibraryEntry(signalId) : null;
  const direction = input.direction || library?.direction || "min";
  const displayName =
    input.display_name?.trim() || library?.display_name || humanizeSignalId(signalId);
  const description = input.description?.trim() || library?.description || null;
  const unit = input.unit ?? library?.unit ?? inferUnit(signalId, direction);
  const sourceId = input.source_id || (library ? null : "custom");
  const id = `wsig_${crypto.randomBytes(8).toString("hex")}`;
  const now = nowIso();

  await run(
    `INSERT INTO workspace_signal_definitions
      (id, workspace_id, signal_id, display_name, description, direction, unit, source_id, from_library, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      id,
      workspaceId,
      signalId,
      displayName,
      description,
      direction,
      unit,
      sourceId,
      input.from_library || library ? 1 : 0,
      now
    ]
  );

  if (!opts.skipThresholdUpsert) {
    const thresholdInput = input.threshold || library?.suggested_threshold || {};
    const min = thresholdInput.min ?? null;
    const max = thresholdInput.max ?? null;
    const required =
      input.required_for_certification ??
      (sharedPkg.defaultRequiredSignalIds || []).includes(signalId);

    await upsertThresholdForDefinition(workspaceId, signalId, {
      min,
      max,
      required_for_certification: required
    });
  }

  return getWorkspaceDefinition(workspaceId, signalId);
}

async function adoptLibrarySignal(workspaceId, signalId, opts = {}) {
  const library = await getLibraryEntry(signalId);
  if (!library) throw new Error("library signal not found");

  const detached = await queryOne(
    `SELECT * FROM workspace_signal_definitions
     WHERE workspace_id = $1 AND signal_id = $2 AND detached_at IS NOT NULL`,
    [workspaceId, signalId]
  );
  if (detached) {
    await run(
      `UPDATE workspace_signal_definitions SET detached_at = NULL WHERE workspace_id = $1 AND signal_id = $2`,
      [workspaceId, signalId]
    );
    const stored = await getStoredThresholdRow(workspaceId, signalId);
    const threshold = opts.threshold || (stored ? { min: stored.min, max: stored.max } : null);
    if (threshold || opts.required_for_certification !== undefined) {
      await upsertThresholdForDefinition(workspaceId, signalId, {
        min: threshold?.min ?? stored?.min ?? null,
        max: threshold?.max ?? stored?.max ?? null,
        required_for_certification:
          opts.required_for_certification !== undefined
            ? opts.required_for_certification
            : stored?.required_for_certification
      });
    }
    return getWorkspaceDefinition(workspaceId, signalId);
  }

  const stored = await getStoredThresholdRow(workspaceId, signalId);
  const threshold =
    opts.threshold ||
    (stored ? { min: stored.min, max: stored.max } : null) ||
    library.suggested_threshold;
  const required =
    opts.required_for_certification !== undefined
      ? opts.required_for_certification
      : stored?.required_for_certification;
  return createWorkspaceDefinition(workspaceId, {
    signal_id: signalId,
    from_library: true,
    threshold,
    required_for_certification: required
  });
}

/** Detach signal from workspace gating. Library signals keep threshold rows for re-adopt. */
async function deleteWorkspaceDefinition(workspaceId, signalId) {
  const existing = await getWorkspaceDefinition(workspaceId, signalId);
  if (!existing) return;
  const keepThreshold =
    existing.from_library && existing.source_id !== "custom" && existing.source_id !== "zizkadb";
  if (keepThreshold) {
    await run(
      `UPDATE workspace_signal_definitions SET detached_at = $1::timestamptz
       WHERE workspace_id = $2 AND signal_id = $3 AND detached_at IS NULL`,
      [nowIso(), workspaceId, signalId]
    );
    return;
  }
  await run("DELETE FROM workspace_signal_definitions WHERE workspace_id = $1 AND signal_id = $2", [
    workspaceId,
    signalId
  ]);
  await run("DELETE FROM thresholds WHERE workspace_id = $1 AND signal_id = $2", [workspaceId, signalId]);
  await run("DELETE FROM thresholds WHERE workspace_id = $1 AND signal_id = $2", [
    workspaceId,
    `${signalId}_delta`
  ]);
}

async function backfillDefinitionsFromThresholds(workspaceId) {
  const thresholdRows = await queryAll(
    "SELECT signal_id FROM thresholds WHERE workspace_id = $1",
    [workspaceId]
  );
  for (const row of thresholdRows) {
    const detached = await queryOne(
      `SELECT 1 AS ok FROM workspace_signal_definitions
       WHERE workspace_id = $1 AND signal_id = $2 AND detached_at IS NOT NULL`,
      [workspaceId, row.signal_id]
    );
    if (detached) continue;
    const existing = await getWorkspaceDefinition(workspaceId, row.signal_id);
    if (existing) continue;
    const library = await getLibraryEntry(row.signal_id);
    await createWorkspaceDefinition(
      workspaceId,
      {
        signal_id: row.signal_id,
        from_library: !!library,
        display_name: library?.display_name,
        direction: library?.direction,
        unit: library?.unit,
        description: library?.description,
        source_id: library ? null : "legacy"
      },
      { skipThresholdUpsert: true }
    );
  }
}

async function ensureWorkspaceSignalDefinitions(workspaceId) {
  await ensureGlobalCatalogSeeded();
  const countRow = await queryOne(
    "SELECT COUNT(*) AS c FROM workspace_signal_definitions WHERE workspace_id = $1 AND detached_at IS NULL",
    [workspaceId]
  );
  if (Number(countRow?.c || 0) > 0) return;

  await backfillDefinitionsFromThresholds(workspaceId);

  const afterBackfill = await queryOne(
    "SELECT COUNT(*) AS c FROM workspace_signal_definitions WHERE workspace_id = $1 AND detached_at IS NULL",
    [workspaceId]
  );
  if (Number(afterBackfill?.c || 0) > 0) return;
}

async function getWorkspaceSignalCatalog(workspaceId) {
  await ensureWorkspaceSignalDefinitions(workspaceId);
  const { getThresholdMap } = require("./workspaceConfig");
  const [definitions, library, connectors, thresholds] = await Promise.all([
    listWorkspaceDefinitions(workspaceId),
    listLibraryEntries(),
    listConnectorSignals(),
    getThresholdMap(workspaceId)
  ]);
  const adopted = new Set(definitions.map((d) => d.signal_id));
  const librarySuggestions = library.filter((entry) => !adopted.has(entry.signal_id));
  return {
    workspace_id: workspaceId,
    definitions,
    library: librarySuggestions,
    connectors,
    thresholds: filterThresholdMapForAdopted(thresholds, adopted)
  };
}

module.exports = {
  ensureGlobalCatalogSeeded,
  ensureWorkspaceSignalDefinitions,
  listWorkspaceDefinitions,
  listLibraryEntries,
  listConnectorSignals,
  getWorkspaceSignalCatalog,
  createWorkspaceDefinition,
  adoptLibrarySignal,
  deleteWorkspaceDefinition,
  getWorkspaceDefinition,
  humanizeSignalId,
  isSignalAdoptedForGating,
  filterThresholdMapForAdopted
};
