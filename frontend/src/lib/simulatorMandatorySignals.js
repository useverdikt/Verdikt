import shared from "../../../shared/config.json";
import { applyThresholdApiMap, defaultRequiredFlags } from "./thresholdBounds.js";
import { readLocalThresholdUiState } from "./simulatorSignalDefinitions.js";
import { showstopperLabelToMaxWorstIndex } from "./severityThresholds.js";

const SOURCE_MAP = shared.signalSourceMap || {};

function isManualQaSeverityVisible(thresholdMap) {
  const row = thresholdMap?.manual_qa_worst_severity;
  if (row && (row.max != null || row.min != null)) return true;
  const ui = readLocalThresholdUiState();
  return !!ui.manual_qa_showstopper;
}

function isSimulatorSignalRequired(signalId, thresholdMap) {
  if (signalId === "manual_qa_worst_severity") return isManualQaSeverityVisible(thresholdMap);
  return !!thresholdMap?.[signalId]?.required_for_certification;
}

/**
 * Build threshold map for signal sim: API rows + saved required flags + localStorage overlay.
 * @param {Record<string, object>} apiRaw — GET /thresholds map
 */
export function buildSimulatorThresholdMap(apiRaw) {
  const parsed = applyThresholdApiMap(apiRaw);
  let localRequired = {};
  try {
    localRequired = JSON.parse(localStorage.getItem("vdk3_thresholdRequired") || "{}");
  } catch (_) {
    /* ignore */
  }
  const defaults = defaultRequiredFlags();
  const map = { ...(apiRaw || {}) };
  const ids = new Set([
    ...Object.keys(map),
    ...Object.keys(parsed.required),
    ...Object.keys(localRequired),
    ...Object.keys(defaults)
  ]);
  for (const id of ids) {
    const row = map[id] && typeof map[id] === "object" ? { ...map[id] } : {};
    const req =
      localRequired[id] ??
      parsed.required[id] ??
      row.required_for_certification ??
      defaults[id] ??
      false;
    row.required_for_certification = !!req;
    map[id] = row;
  }
  const ui = readLocalThresholdUiState();
  const maxWorst =
    map.manual_qa_worst_severity?.max ??
    showstopperLabelToMaxWorstIndex(ui.manual_qa_showstopper ?? "P0");
  map.manual_qa_worst_severity = {
    ...(map.manual_qa_worst_severity || {}),
    min: null,
    max: maxWorst,
    required_for_certification: false
  };
  return map;
}

/**
 * Filter signal simulator sources to mandatory certification signals.
 * Does not require Settings connection — sim ingest is for test/pre-prod.
 * @param {Array<{ id: string, signals: Array<{ id: string }> }>} sources
 * @param {Record<string, { required_for_certification?: boolean }>} thresholdMap
 * @param {Set<string>|string[]} connectedSourceIds — for UI badges only
 */
export function filterSimulatorSourcesForMandatory(sources, thresholdMap, connectedSourceIds) {
  const connected = connectedSourceIds instanceof Set ? connectedSourceIds : new Set(connectedSourceIds || []);
  return sources
    .map((src) => {
      const allowed = new Set(SOURCE_MAP[src.id] || []);
      const signals = (src.signals || []).filter((sig) => {
        if (!allowed.has(sig.id)) return false;
        return isSimulatorSignalRequired(sig.id, thresholdMap);
      });
      if (!signals.length) return null;
      return {
        ...src,
        signals,
        sourceConnected: connected.has(src.id)
      };
    })
    .filter(Boolean);
}

/** Count signals marked required in threshold map that appear in signalSourceMap. */
export function countSimulatorEligibleRequired(thresholdMap) {
  const simSignalIds = new Set(Object.values(SOURCE_MAP).flat());
  let required = 0;
  for (const id of simSignalIds) {
    if (thresholdMap?.[id]?.required_for_certification) required++;
  }
  return required;
}

/**
 * Human-readable hint when signal sim has no panels to show.
 */
export function getSimulatorEmptyHint(thresholdMap, connectedSourceIds, sources) {
  const eligibleRequired = countSimulatorEligibleRequired(thresholdMap);
  if (eligibleRequired === 0) {
    return {
      title: "No mandatory signals for simulation",
      body: "Open App → Thresholds, mark signals as Required, then click Save Thresholds. Panels appear for Braintrust, BrowserStack, Sentry, Datadog, and Manual QA signals marked required (showstopper severity always simulates when configured)."
    };
  }
  const connected = connectedSourceIds instanceof Set ? connectedSourceIds : new Set(connectedSourceIds || []);
  if (connected.size === 0) {
    return {
      title: "Required signals found — ready to simulate",
      body: `You have ${eligibleRequired} required signal(s) configured, but no live integrations are connected in Settings. Source panels should appear below for simulated ingest. Connect sources in Settings → Signal Sources for production pulls.`
    };
  }
  return {
    title: "No matching simulator panels",
    body: "Required flags may not be saved yet. Click Save Thresholds in App → Thresholds, then refresh this page."
  };
}
