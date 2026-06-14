import shared from "../../../shared/config.json";

/** Catalog of signal source lanes (not live SDK integrations — connection is via Settings API keys + pull/webhook). */
export const RELEASE_SOURCE_CATALOG = [
  { id: "braintrust", name: "Braintrust", icon: "◐", color: "#f472b6", signals: shared.signalSourceMap?.braintrust || [] },
  { id: "browserstack", name: "BrowserStack", icon: "◎", color: "#f87171", signals: shared.signalSourceMap?.browserstack || [] },
  { id: "sentry", name: "Sentry", icon: "⚡", color: "#fb923c", signals: shared.signalSourceMap?.sentry || [] },
  { id: "datadog", name: "Datadog", icon: "◈", color: "#60a5fa", signals: shared.signalSourceMap?.datadog || [] },
  { id: "langsmith", name: "LangSmith", icon: "◇", color: "#a78bfa", signals: shared.signalSourceMap?.langsmith || [] },
  { id: "manual_qa", name: "Manual QA", icon: "✦", color: "#94a3b8", signals: shared.signalSourceMap?.manual_qa || [] }
];

/** Groupings for source pickers (thresholds custom signal, settings, etc.). */
export const SIGNAL_SOURCE_SECTIONS = [
  { id: "ai_eval", label: "AI Eval Quality", sourceIds: ["braintrust", "langsmith"] },
  { id: "delivery", label: "Delivery Reliability", sourceIds: ["browserstack"] },
  { id: "reliability", label: "Runtime Reliability", sourceIds: ["sentry"] },
  { id: "performance", label: "Runtime Performance", sourceIds: ["datadog"] },
  { id: "manual_qa", label: "Risk Scenario Review", sourceIds: ["manual_qa"] },
  { id: "partner", label: "Partner / API push", sourceIds: ["zizkadb", "custom"] }
];

const STATUS_META = {
  not_configured: { label: "Not configured", tone: "muted" },
  connected_waiting: { label: "Connected — awaiting SHA match", tone: "amber" },
  received: { label: "Signals received", tone: "green" },
  pull_failed: { label: "Connected — pull failed", tone: "red" }
};

function signalsReceivedForSource(signalRows, sourceId) {
  const prefix = sourceId.toLowerCase();
  return (signalRows || []).some((row) => {
    const src = String(row.source || "").toLowerCase();
    return src.includes(prefix) || src.includes(`pulled:${prefix}`) || src.includes(`simulator:${prefix}`);
  });
}

function pullFailedForSource(integrationPull, sourceId) {
  const results = integrationPull?.results || {};
  const row = results[sourceId];
  if (row && row.ok === false) return true;
  return (integrationPull?.warnings || []).some((w) => w.source === sourceId);
}

/**
 * Build honest source lanes for a cert window — configured vs received vs failed.
 */
export function buildReleaseSourceLanes({
  connectedIntegrationIds = [],
  signalRows = [],
  integrationPull = null,
  releaseStatus = ""
} = {}) {
  const connected = new Set(connectedIntegrationIds);
  const isCollecting = String(releaseStatus).toUpperCase() === "COLLECTING";

  return RELEASE_SOURCE_CATALOG.map((src) => {
    const configured = connected.has(src.id);
    const received = signalsReceivedForSource(signalRows, src.id);
    const failed = configured && !received && pullFailedForSource(integrationPull, src.id);

    let connectionStatus = "not_configured";
    if (received) connectionStatus = "received";
    else if (failed) connectionStatus = "pull_failed";
    else if (configured) connectionStatus = "connected_waiting";

    const meta = STATUS_META[connectionStatus];
    let uiStatus = "waiting";
    if (received) uiStatus = "arrived";
    else if (!isCollecting && !configured) uiStatus = "idle";

    return {
      ...src,
      status: uiStatus,
      connectionStatus,
      statusLabel: meta.label,
      statusTone: meta.tone,
      configured,
      ingestPath: configured
        ? "API pull / webhook (Settings → Signal sources)"
        : "Not configured — connect in Settings or ingest via API"
    };
  }).filter((src) => isCollecting || src.configured || src.status === "arrived");
}

export function integrationPullBannerWarnings(integrationPull) {
  const warnings = integrationPull?.warnings;
  if (!Array.isArray(warnings) || !warnings.length) return [];
  return warnings.map((w) => (typeof w === "string" ? w : w.message)).filter(Boolean);
}
