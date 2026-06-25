"use strict";

const { listIntegrations, getLatestCsvImport } = require("./signalIntegrations");
const { listConnectorSignals, listWorkspaceDefinitions } = require("./signalDefinitions");
const { listIntegrationRequests } = require("./integrationRequests");

function ingestModeBySource(connectors) {
  const map = {};
  for (const c of connectors) {
    if (!map[c.source_id]) map[c.source_id] = c.ingest_mode || "pull";
  }
  return map;
}

async function buildSignalSourcesPanel(workspaceId) {
  const [integrations, connectors, definitions, requests, csvImport] = await Promise.all([
    listIntegrations(workspaceId),
    listConnectorSignals(),
    listWorkspaceDefinitions(workspaceId),
    listIntegrationRequests(workspaceId),
    getLatestCsvImport(workspaceId)
  ]);

  const connectedPullIds = new Set(integrations.map((i) => i.source_id));
  const modeBySource = ingestModeBySource(connectors);

  const pullSourceIds = new Set();
  for (const c of connectors) {
    if ((c.ingest_mode || "pull") === "pull" && c.source_id !== "custom") {
      pullSourceIds.add(c.source_id);
    }
  }

  const signalCountByPullSource = {};
  for (const c of connectors) {
    if (pullSourceIds.has(c.source_id)) {
      signalCountByPullSource[c.source_id] = (signalCountByPullSource[c.source_id] || 0) + 1;
    }
  }

  const pull_connectors = [...pullSourceIds].sort().map((source_id) => {
    const int = integrations.find((i) => i.source_id === source_id);
    return {
      source_id,
      ingest_mode: "pull",
      connected: connectedPullIds.has(source_id),
      signal_count: signalCountByPullSource[source_id] || 0,
      ...(int ? { masked_key: int.masked_key, verified_at: int.verified_at } : {})
    };
  });

  const pushGroups = new Map();
  for (const def of definitions) {
    const sid = def.source_id || "custom";
    const mode = modeBySource[sid] || (sid === "custom" ? "push" : "pull");
    if (mode === "push") {
      if (!pushGroups.has(sid)) pushGroups.set(sid, []);
      pushGroups.get(sid).push(def.signal_id);
    }
  }

  for (const c of connectors) {
    if (c.ingest_mode === "push" && c.source_id !== "custom" && !pushGroups.has(c.source_id)) {
      pushGroups.set(c.source_id, []);
    }
  }

  const push_sources = [...pushGroups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([source_id, signal_ids]) => ({
      source_id,
      ingest_mode: "push",
      signal_ids,
      signal_count: signal_ids.length,
      active: signal_ids.length > 0
    }));

  return {
    pull_connectors,
    push_sources,
    integration_requests: requests,
    api_push: {
      ingest_path: "/api/releases/{release_id}/signals",
      auth_hint: "Bearer API key from Agent access",
      docs_hint: "POST JSON with signal values keyed by signal_id"
    },
    csv_import: csvImport && Number(csvImport.row_count) > 0 ? csvImport : null
  };
}

module.exports = { buildSignalSourcesPanel };
