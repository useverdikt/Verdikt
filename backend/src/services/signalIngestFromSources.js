"use strict";

/**
 * Applies CSV rows and remote integration metrics into the same
 * `signals` + `evaluateReleaseAfterSignalIngest` path as manual / webhook ingest.
 */

const { queryOne, queryAll, run, transaction } = require("../database");
const { nowIso } = require("../lib/time");
const { evaluateReleaseAfterSignalIngest } = require("./domain");
const { decryptStoredApiKey } = require("./signalIntegrations");
const {
  extractVersionFromRow,
  mapFlatRowToSignals,
  mapIntegrationSignals,
  resolveReleaseForWorkspaceIngest,
  releaseVerdictLockedAgainstIngest
} = require("./verdictEngine");

function parseExtraJson(row) {
  if (!row || !row.extra_json) return {};
  try {
    return JSON.parse(row.extra_json);
  } catch {
    return {};
  }
}

function integrationTestMock(sid) {
  if (sid === "langsmith") {
    return {
      signals: { accuracy: 87, safety: 91, tone: 84, hallucination: 93, relevance: 86 },
      matched: true
    };
  }
  if (sid === "sentry") {
    return { signals: { crashrate: 0.06, errorrate: 0.45, anrrate: 0.02 }, matched: true };
  }
  if (sid === "datadog") {
    return { signals: { p95latency: 240, p99latency: 480 }, matched: true };
  }
  return { signals: {}, matched: false };
}

/**
 * @param {string} apiKey
 * @param {string} version
 */
async function pullBraintrustExperimentSignals(apiKey, version) {
  const ver = String(version || "").trim();
  if (!ver) return { signals: {}, matched: false, error: "empty_version" };

  if (process.env.NODE_ENV === "test" || process.env.SKIP_INTEGRATION_PULL === "1") {
    return {
      signals: { accuracy: 88, safety: 90, tone: 86, hallucination: 92, relevance: 85 },
      matched: true
    };
  }

  const res = await fetch("https://api.braintrust.dev/v1/experiment?limit=120", {
    headers: { Authorization: `Bearer ${apiKey}` }
  });
  if (res.status === 401 || res.status === 403) {
    return { signals: {}, matched: false, error: "invalid_braintrust_key" };
  }
  if (!res.ok) {
    return { signals: {}, matched: false, error: `braintrust_http_${res.status}` };
  }
  const data = await res.json();
  const objs = Array.isArray(data.objects) ? data.objects : [];
  const match = objs.find((e) => {
    const n = String(e.name || "");
    const meta = e.metadata || {};
    return (
      (ver && n.includes(ver)) ||
      String(meta.version || "") === ver ||
      String(meta.release || "") === ver ||
      String(meta.release_version || "") === ver
    );
  });
  if (!match) return { signals: {}, matched: false, error: "no_experiment_for_version" };

  const raw = {
    ...(match.scores && typeof match.scores === "object" ? match.scores : {}),
    ...(match.metrics && typeof match.metrics === "object" ? match.metrics : {}),
    ...(match.summary && typeof match.summary === "object" ? match.summary : {})
  };
  const metrics = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "number" && Number.isFinite(v)) metrics[k] = v;
    else if (v && typeof v === "object") {
      if (typeof v.score === "number" && Number.isFinite(v.score)) metrics[k] = v.score;
      else if (typeof v.mean === "number" && Number.isFinite(v.mean)) metrics[k] = v.mean;
    }
  }
  const mapped = mapIntegrationSignals("braintrust", { metrics });
  return { signals: mapped.signals, matched: Object.keys(mapped.signals).length > 0 };
}

async function pullLangSmithSignals(apiKey, version) {
  const ver = String(version || "").trim();
  if (!ver) return { signals: {}, matched: false, error: "empty_version" };

  if (process.env.NODE_ENV === "test" || process.env.SKIP_INTEGRATION_PULL === "1") {
    return integrationTestMock("langsmith");
  }

  const headers = { "Content-Type": "application/json", "x-api-key": apiKey };
  let res = await fetch("https://api.smith.langchain.com/api/v1/runs/query", {
    method: "POST",
    headers,
    body: JSON.stringify({
      limit: 150,
      is_root: true,
      select: ["id", "name", "extra", "outputs", "feedback_stats", "run_type"]
    })
  });
  if (res.status === 401 || res.status === 403) {
    res = await fetch("https://api.smith.langchain.com/api/v1/runs/query", {
      method: "POST",
      headers: { ...headers, Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        limit: 150,
        is_root: true,
        select: ["id", "name", "extra", "outputs", "feedback_stats", "run_type"]
      })
    });
  }
  if (!res.ok) return { signals: {}, matched: false, error: `langsmith_http_${res.status}` };

  const data = await res.json();
  const runs = Array.isArray(data.runs) ? data.runs : Array.isArray(data.data) ? data.data : [];
  const match = runs.find((r) => {
    const n = String(r.name || "");
    const ex = r.extra && typeof r.extra === "object" ? r.extra : {};
    const meta = ex.metadata && typeof ex.metadata === "object" ? ex.metadata : {};
    return (
      (ver && n.includes(ver)) ||
      String(meta.version || "") === ver ||
      String(meta.release || "") === ver ||
      String(meta.release_tag || "") === ver
    );
  });
  if (!match) return { signals: {}, matched: false, error: "no_run_for_version" };

  const metrics = {};
  const out = match.outputs && typeof match.outputs === "object" ? match.outputs : {};
  const scores = out.scores && typeof out.scores === "object" ? out.scores : out;
  for (const [k, v] of Object.entries(scores)) {
    if (typeof v === "number" && Number.isFinite(v)) metrics[k] = v;
  }
  if (match.feedback_stats && typeof match.feedback_stats === "object") {
    for (const [k, v] of Object.entries(match.feedback_stats)) {
      if (typeof v === "number" && Number.isFinite(v)) metrics[k] = v;
    }
  }
  const mapped = mapIntegrationSignals("langsmith", { metrics });
  return { signals: mapped.signals, matched: Object.keys(mapped.signals).length > 0 };
}

async function pullSentrySignals(token, version) {
  const ver = String(version || "").trim();
  if (!ver) return { signals: {}, matched: false, error: "empty_version" };

  if (process.env.NODE_ENV === "test" || process.env.SKIP_INTEGRATION_PULL === "1") {
    return integrationTestMock("sentry");
  }

  const auth = { Authorization: `Bearer ${token}` };
  const orgsRes = await fetch("https://sentry.io/api/0/organizations/", { headers: auth });
  if (!orgsRes.ok) return { signals: {}, matched: false, error: `sentry_orgs_${orgsRes.status}` };
  const orgs = await orgsRes.json();
  const slug = Array.isArray(orgs) && orgs[0]?.slug ? orgs[0].slug : null;
  if (!slug) return { signals: {}, matched: false, error: "no_sentry_org" };

  const enc = encodeURIComponent(ver);
  let relRes = await fetch(`https://sentry.io/api/0/organizations/${slug}/releases/${enc}/`, { headers: auth });
  if (!relRes.ok) {
    return { signals: {}, matched: false, error: `release_not_found_${relRes.status}` };
  }
  const rel = await relRes.json();

  let healthRes = await fetch(
    `https://sentry.io/api/0/organizations/${slug}/releases/${enc}/health/sessions/?statsPeriod=24h`,
    { headers: auth }
  );
  const metrics = {};
  if (healthRes.ok) {
    const health = await healthRes.json();
    const detail = health.detail && typeof health.detail === "object" ? health.detail : health;
    const adoption = detail.session_adoption || detail.sessions || detail;
    const crashRate =
      adoption?.crash_rate ??
      adoption?.crashRate ??
      (typeof adoption?.crashed === "number" && typeof adoption?.total === "number"
        ? adoption.crashed / Math.max(1, adoption.total)
        : null);
    if (typeof crashRate === "number" && Number.isFinite(crashRate)) {
      metrics.crashrate = crashRate > 1 ? crashRate / 100 : crashRate;
    }
    const errRate =
      adoption?.error_rate ?? adoption?.errorRate ?? (typeof adoption?.errored === "number" ? adoption.errored / Math.max(1, adoption.total || 1) : null);
    if (typeof errRate === "number" && Number.isFinite(errRate)) {
      metrics.errorrate = errRate > 1 ? errRate / 100 : errRate;
    }
  }

  if (!Object.keys(metrics).length && typeof rel.newGroups === "number") {
    metrics.errorrate = Math.min(1, rel.newGroups / 50);
  }

  const mapped = mapIntegrationSignals("sentry", { metrics });
  const matched = Object.keys(mapped.signals).length > 0;
  return { signals: mapped.signals, matched, error: matched ? undefined : "no_sentry_metrics" };
}

async function pullDatadogSignals(apiKey, appKey, site, extra) {
  if (!apiKey || !appKey) return { signals: {}, matched: false, error: "missing_datadog_keys" };

  if (process.env.NODE_ENV === "test" || process.env.SKIP_INTEGRATION_PULL === "1") {
    return integrationTestMock("datadog");
  }

  const siteHost = String(site || "datadoghq.com").trim() || "datadoghq.com";
  const base = `https://api.${siteHost}`;
  const from = Math.floor(Date.now() / 1000) - 7200;
  const to = Math.floor(Date.now() / 1000);

  const customQuery =
    typeof extra?.datadog_query === "string" && extra.datadog_query.trim()
      ? extra.datadog_query.trim()
      : "avg:trace.http.request.duration{*}";

  const url = new URL(`${base}/api/v1/query`);
  url.searchParams.set("from", String(from));
  url.searchParams.set("to", String(to));
  url.searchParams.set("query", customQuery);

  const res = await fetch(url, {
    headers: {
      "DD-API-KEY": apiKey,
      "DD-APPLICATION-KEY": appKey
    }
  });
  if (res.status === 403 || res.status === 401) {
    return { signals: {}, matched: false, error: "invalid_datadog_keys" };
  }
  if (!res.ok) return { signals: {}, matched: false, error: `datadog_http_${res.status}` };

  const data = await res.json();
  const series = Array.isArray(data.series) ? data.series : [];
  const vals = [];
  for (const s of series) {
    const pl = s.pointlist || s.points || [];
    for (let i = pl.length - 1; i >= 0; i--) {
      const pt = pl[i];
      const v = Array.isArray(pt) && pt.length >= 2 ? pt[1] : null;
      if (typeof v === "number" && Number.isFinite(v)) {
        vals.push(v);
        break;
      }
    }
  }
  vals.sort((a, b) => a - b);

  const metrics = {};
  if (vals.length) {
    metrics.p95latency = vals[Math.floor((vals.length - 1) * 0.95)] ?? vals[vals.length - 1];
    metrics.p99latency = vals[Math.floor((vals.length - 1) * 0.99)] ?? vals[vals.length - 1];
  }
  if (!Object.keys(metrics).length) {
    return {
      signals: {},
      matched: false,
      error: "no_datadog_series_set_extra.datadog_query_for_your_apm_metrics"
    };
  }

  const mapped = mapIntegrationSignals("datadog", { metrics });
  return { signals: mapped.signals, matched: Object.keys(mapped.signals).length > 0 };
}

async function deleteSignalsForCsvImport(importId) {
  await run("DELETE FROM signals WHERE source = ?", [`csv:${importId}`]);
}

async function applyPulledSignals(releaseId, sourceTag, version, signals, outKey) {
  const insertSql = `INSERT INTO signals (release_id, signal_id, value, source, created_at, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?)`;
  await run("DELETE FROM signals WHERE release_id = ? AND source = ?", [releaseId, sourceTag]);

  let n = 0;
  await transaction(async (tx) => {
    for (const [signalId, value] of Object.entries(signals)) {
      const idem = `pull:${outKey}:${version}:${signalId}`;
      await tx.run(insertSql, [releaseId, signalId, value, sourceTag, nowIso(), idem]);
      n += 1;
    }
  });

  const fresh = await queryOne("SELECT * FROM releases WHERE id = ?", [releaseId]);
  const evalResult = await evaluateReleaseAfterSignalIngest(fresh, releaseId, sourceTag, n);
  return { ok: true, signals: Object.keys(signals), evaluation: evalResult };
}

async function applyCsvImportToWorkspace(workspaceId, importId) {
  const row = await queryOne("SELECT * FROM signal_csv_imports WHERE id = ? AND workspace_id = ?", [
    importId,
    workspaceId
  ]);
  if (!row) return { applied: false, reason: "import_not_found" };
  if (!row.rows_json) return { applied: false, reason: "no_rows_json_reupload_csv" };

  let rows;
  try {
    rows = JSON.parse(row.rows_json);
  } catch {
    return { applied: false, reason: "invalid_rows_json" };
  }
  if (!Array.isArray(rows) || rows.length === 0) return { applied: false, reason: "empty_rows" };

  await deleteSignalsForCsvImport(importId);

  const insertSignalSql = `INSERT INTO signals (release_id, signal_id, value, source, created_at, idempotency_key)
     VALUES (?, ?, ?, ?, ?, ?)`;

  const byRelease = new Map();
  const skipped = [];

  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const csvRow = rows[rowIndex];
    const ver = extractVersionFromRow(csvRow);
    if (!ver) {
      skipped.push({ row: rowIndex, reason: "no_version_column" });
      continue;
    }
    const rel = await resolveReleaseForWorkspaceIngest(workspaceId, { version: ver });
    if (!rel) {
      skipped.push({ row: rowIndex, reason: "release_not_found", version: ver });
      continue;
    }
    if (releaseVerdictLockedAgainstIngest(rel)) {
      skipped.push({ row: rowIndex, reason: "release_locked", version: ver });
      continue;
    }
    const signals = mapFlatRowToSignals(csvRow);
    if (!Object.keys(signals).length) {
      skipped.push({ row: rowIndex, reason: "no_mappable_signals", version: ver });
      continue;
    }
    if (!byRelease.has(rel.id)) {
      byRelease.set(rel.id, { release: rel, batches: [] });
    }
    byRelease.get(rel.id).batches.push({ rowIndex, signals });
  }

  const releasesOut = [];

  for (const [releaseId, { release, batches }] of byRelease) {
    let inserted = 0;
    await transaction(async (tx) => {
      for (const { rowIndex, signals } of batches) {
        for (const [signalId, value] of Object.entries(signals)) {
          const idem = `csv:${importId}:r${rowIndex}:${signalId}`;
          await tx.run(insertSignalSql, [
            releaseId,
            signalId,
            value,
            `csv:${importId}`,
            nowIso(),
            idem
          ]);
          inserted += 1;
        }
      }
    });

    const evalOut = await evaluateReleaseAfterSignalIngest(release, releaseId, `csv:${importId}`, inserted);
    releasesOut.push({
      release_id: releaseId,
      version: release.version,
      signals_inserted: inserted,
      evaluation: evalOut
    });
  }

  return {
    applied: true,
    import_id: importId,
    skipped,
    releases: releasesOut
  };
}

async function pullConnectedSourcesForRelease(release) {
  const out = {};
  const ws = release.workspace_id;
  const rid = release.id;
  const version = String(release.version || "").trim();

  if (releaseVerdictLockedAgainstIngest(release)) {
    return { ok: false, error: "release_locked", sources: {} };
  }

  const integrationRows = await queryAll(
    "SELECT source_id, api_key, extra_json FROM signal_integrations WHERE workspace_id = ?",
    [ws]
  );

  if (!integrationRows.length) {
    return { ok: true, workspace_id: ws, release_id: rid, sources: {}, message: "no_connected_integrations" };
  }

  for (const integ of integrationRows) {
    const sid = integ.source_id;
    const extra = parseExtraJson(integ);
    const apiKeyPlain = decryptStoredApiKey(integ.api_key, ws, sid);

    if (sid === "braintrust") {
      const pull = await pullBraintrustExperimentSignals(apiKeyPlain, version);
      if (!pull.matched || !Object.keys(pull.signals || {}).length) {
        out.braintrust = { ok: false, error: pull.error || "no_signals" };
        continue;
      }
      out.braintrust = await applyPulledSignals(rid, "pulled:braintrust", version, pull.signals, "braintrust");
      continue;
    }

    if (sid === "langsmith") {
      const pull = await pullLangSmithSignals(apiKeyPlain, version);
      if (!pull.matched || !Object.keys(pull.signals || {}).length) {
        out.langsmith = { ok: false, error: pull.error || "no_signals" };
        continue;
      }
      out.langsmith = await applyPulledSignals(rid, "pulled:langsmith", version, pull.signals, "langsmith");
      continue;
    }

    if (sid === "sentry") {
      const pull = await pullSentrySignals(apiKeyPlain, version);
      if (!pull.matched || !Object.keys(pull.signals || {}).length) {
        out.sentry = { ok: false, error: pull.error || "no_signals" };
        continue;
      }
      out.sentry = await applyPulledSignals(rid, "pulled:sentry", version, pull.signals, "sentry");
      continue;
    }

    if (sid === "datadog") {
      const appKey = extra.app_key;
      const site = extra.site || "datadoghq.com";
      const pull = await pullDatadogSignals(apiKeyPlain, appKey, site, extra);
      if (!pull.matched || !Object.keys(pull.signals || {}).length) {
        out.datadog = { ok: false, error: pull.error || "no_signals" };
        continue;
      }
      out.datadog = await applyPulledSignals(rid, "pulled:datadog", version, pull.signals, "datadog");
    }
  }

  return { ok: true, workspace_id: ws, release_id: rid, sources: out };
}

module.exports = {
  applyCsvImportToWorkspace,
  deleteSignalsForCsvImport,
  pullBraintrustExperimentSignals,
  pullConnectedSourcesForRelease
};
