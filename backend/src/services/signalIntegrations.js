"use strict";

/**
 * Workspace-scoped signal source credentials (API integrations + CSV ingest metadata).
 * Remote verification calls vendor HTTP APIs (skipped when NODE_ENV=test or SKIP_SIGNAL_VERIFY=1).
 */

const crypto = require("crypto");
const { queryOne, queryAll, run } = require("../database");
const { nowIso } = require("../lib/time");
const { encryptToken, decryptToken, looksEncrypted, migratePlaintextFieldIfNeeded } = require("../lib/encryption");

const ALLOWED = new Set(["braintrust", "langsmith", "sentry", "datadog"]);

function maskSecret(s) {
  const t = String(s ?? "");
  if (t.length <= 4) return "••••";
  return `••••${t.slice(-4)}`;
}

function decryptStoredApiKey(stored, workspaceId, sourceId) {
  let k = stored;
  if (!looksEncrypted(k)) {
    const mig = migratePlaintextFieldIfNeeded(k, `signal_integrations.api_key:${sourceId}`);
    if (mig !== k) {
      void run("UPDATE signal_integrations SET api_key = ?, updated_at = ? WHERE workspace_id = ? AND source_id = ?", [
        mig,
        nowIso(),
        workspaceId,
        sourceId
      ]);
      k = mig;
    }
  }
  return decryptToken(k);
}

function parseExtra(row) {
  if (!row.extra_json) return {};
  try {
    return JSON.parse(row.extra_json);
  } catch {
    return {};
  }
}

/**
 * @param {string} sourceId
 * @param {{ apiKey: string, appKey?: string, site?: string }} creds
 */
async function verifyRemote(sourceId, creds) {
  if (process.env.SKIP_SIGNAL_VERIFY === "1" || process.env.NODE_ENV === "test") {
    return { ok: true, skipped: true };
  }

  const apiKey = String(creds.apiKey || "").trim();
  if (!apiKey) throw new Error("API key is required");

  if (sourceId === "sentry") {
    const res = await fetch("https://sentry.io/api/0/", {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    if (res.status === 401 || res.status === 403) throw new Error("Invalid Sentry auth token");
    if (!res.ok) throw new Error(`Sentry API returned ${res.status}`);
    return { ok: true };
  }

  if (sourceId === "langsmith") {
    let res = await fetch("https://api.smith.langchain.com/api/v1/sessions?limit=1", {
      headers: { "x-api-key": apiKey }
    });
    if (res.status === 401 || res.status === 403) {
      res = await fetch("https://api.smith.langchain.com/api/v1/sessions?limit=1", {
        headers: { Authorization: `Bearer ${apiKey}` }
      });
    }
    if (res.status === 401 || res.status === 403) throw new Error("Invalid LangSmith API key");
    if (!res.ok) throw new Error(`LangSmith API returned ${res.status}`);
    return { ok: true };
  }

  if (sourceId === "braintrust") {
    const res = await fetch("https://api.braintrust.dev/v1/project", {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    if (res.status === 401 || res.status === 403) throw new Error("Invalid Braintrust API key");
    if (!res.ok) throw new Error(`Braintrust API returned ${res.status}`);
    return { ok: true };
  }

  if (sourceId === "datadog") {
    const appKey = String(creds.appKey || "").trim();
    if (!appKey) throw new Error("Datadog application key is required");
    const site = String(creds.site || "datadoghq.com").trim() || "datadoghq.com";
    const base = `https://api.${site}`;
    const url = new URL(`${base}/api/v1/validate`);
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("application_key", appKey);
    const res = await fetch(url);
    if (res.status === 403) throw new Error("Invalid Datadog API or application key");
    if (!res.ok) throw new Error(`Datadog API returned ${res.status}`);
    return { ok: true };
  }

  throw new Error("Unknown source");
}

function validateBody(sourceId, body) {
  const b = body && typeof body === "object" ? body : {};
  if (sourceId === "datadog") {
    const apiKey = String(b.apiKey || "").trim();
    const appKey = String(b.appKey || "").trim();
    const site = String(b.site || "datadoghq.com").trim() || "datadoghq.com";
    const datadog_query =
      typeof b.datadog_query === "string" && b.datadog_query.trim() ? b.datadog_query.trim() : null;
    if (!apiKey) throw new Error("apiKey is required");
    if (!appKey) throw new Error("appKey is required");
    return { apiKey, appKey, site, datadog_query };
  }
  const apiKey = String(b.apiKey || "").trim();
  if (!apiKey) throw new Error("apiKey is required");
  return { apiKey };
}

/**
 * @returns {Promise<{ masked_key: string, verified_at: string | null, last_verify_error: string | null }>}
 */
async function upsertIntegration(workspaceId, sourceId, body) {
  if (!ALLOWED.has(sourceId)) throw new Error("Invalid source_id");
  const creds = validateBody(sourceId, body);

  let verifyErr = null;
  try {
    await verifyRemote(sourceId, creds);
  } catch (e) {
    verifyErr = e.message || String(e);
    throw new Error(verifyErr);
  }

  const ts = nowIso();
  const extra =
    sourceId === "datadog"
      ? JSON.stringify({
          app_key: creds.appKey,
          site: creds.site,
          ...(creds.datadog_query ? { datadog_query: creds.datadog_query } : {})
        })
      : null;

  const apiKeyEnc = encryptToken(creds.apiKey);
  await run(
    `
    INSERT INTO signal_integrations (workspace_id, source_id, api_key, extra_json, verified_at, last_verify_error, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
    ON CONFLICT(workspace_id, source_id) DO UPDATE SET
      api_key = excluded.api_key,
      extra_json = excluded.extra_json,
      verified_at = excluded.verified_at,
      last_verify_error = NULL,
      updated_at = excluded.updated_at
  `,
    [workspaceId, sourceId, apiKeyEnc, extra, ts, ts, ts]
  );

  return {
    source_id: sourceId,
    masked_key: maskSecret(creds.apiKey),
    verified_at: ts,
    last_verify_error: null
  };
}

function rowToPublic(row) {
  const extra = parseExtra(row);
  const plainKey = decryptStoredApiKey(row.api_key, row.workspace_id, row.source_id);
  return {
    source_id: row.source_id,
    connected: true,
    masked_key: maskSecret(plainKey),
    verified_at: row.verified_at || null,
    last_verify_error: row.last_verify_error || null,
    ...(row.source_id === "datadog" && extra.site ? { site: extra.site } : {})
  };
}

async function listIntegrations(workspaceId) {
  const rows = await queryAll(
    `SELECT workspace_id, source_id, api_key, extra_json, verified_at, last_verify_error, created_at, updated_at
     FROM signal_integrations WHERE workspace_id = ?`,
    [workspaceId]
  );
  return rows.map(rowToPublic);
}

async function deleteIntegration(workspaceId, sourceId) {
  if (!ALLOWED.has(sourceId)) throw new Error("Invalid source_id");
  const r = await run("DELETE FROM signal_integrations WHERE workspace_id = ? AND source_id = ?", [workspaceId, sourceId]);
  return r.changes > 0;
}

/** Simple CSV: header row + comma-separated fields; strips surrounding quotes. */
function parseCsvRows(content) {
  const text = String(content || "").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((ln) => ln.trim().length > 0);
  if (lines.length < 2) {
    throw new Error("CSV must include a header row and at least one data row");
  }
  const splitLine = (line) => {
    const out = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        q = !q;
      } else if (c === "," && !q) {
        out.push(cur.trim());
        cur = "";
      } else {
        cur += c;
      }
    }
    out.push(cur.trim());
    return out.map((cell) => cell.replace(/^"|"$/g, ""));
  };
  const header = splitLine(lines[0]).map((h) => h.trim());
  if (!header.length || !header[0]) throw new Error("CSV header is empty");
  const dataRows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]);
    if (cells.length === 1 && cells[0] === "") continue;
    const row = {};
    header.forEach((h, j) => {
      row[h] = cells[j] != null ? cells[j] : "";
    });
    dataRows.push(row);
  }
  if (!dataRows.length) throw new Error("No data rows found after the header");
  return { columns: header, rows: dataRows };
}

async function importCsv(workspaceId, buffer, filename) {
  const { columns, rows } = parseCsvRows(buffer.toString("utf8"));
  const id = `csv_${workspaceId}_${crypto.randomBytes(8).toString("hex")}`;
  const preview = rows.slice(0, 5);
  const ts = nowIso();
  await run(
    `
    INSERT INTO signal_csv_imports (id, workspace_id, filename, row_count, columns_json, preview_json, rows_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
    [
      id,
      workspaceId,
      String(filename || "upload.csv").slice(0, 512),
      rows.length,
      JSON.stringify(columns),
      JSON.stringify(preview),
      JSON.stringify(rows),
      ts
    ]
  );
  return {
    import_id: id,
    filename: String(filename || "upload.csv"),
    row_count: rows.length,
    columns,
    preview
  };
}

async function deleteCsvImports(workspaceId) {
  const ids = await queryAll("SELECT id FROM signal_csv_imports WHERE workspace_id = ?", [workspaceId]);
  for (const { id } of ids) {
    await run("DELETE FROM signals WHERE source = ?", [`csv:${id}`]);
  }
  await run("DELETE FROM signal_csv_imports WHERE workspace_id = ?", [workspaceId]);
}

async function getLatestCsvImport(workspaceId) {
  const row = await queryOne(
    `SELECT id, workspace_id, filename, row_count, columns_json, preview_json, rows_json, created_at
     FROM signal_csv_imports WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 1`,
    [workspaceId]
  );
  if (!row) return null;
  let columns = [];
  let preview = [];
  let storedRows = null;
  try {
    columns = JSON.parse(row.columns_json);
  } catch {
    /* ignore */
  }
  try {
    preview = JSON.parse(row.preview_json);
  } catch {
    /* ignore */
  }
  try {
    if (row.rows_json) storedRows = JSON.parse(row.rows_json);
  } catch {
    /* ignore */
  }
  return {
    import_id: row.id,
    filename: row.filename,
    row_count: row.row_count,
    columns,
    preview,
    rows: Array.isArray(storedRows) ? storedRows : null,
    created_at: row.created_at
  };
}

module.exports = {
  ALLOWED_SOURCES: Array.from(ALLOWED),
  maskSecret,
  verifyRemote,
  upsertIntegration,
  listIntegrations,
  deleteIntegration,
  importCsv,
  getLatestCsvImport,
  deleteCsvImports,
  decryptStoredApiKey
};
