import shared from "../../../shared/config.json";
import {
  getSignalThresholdDirection,
  thresholdBoundsToScalar,
  getDefaultThresholdUiState
} from "./thresholdBounds.js";
import {
  SEVERITY_LEVELS,
  severityToIndex,
  showstopperLabelToMaxWorstIndex,
  passesShowstopperGate
} from "./severityThresholds.js";

const DEFAULTS = shared.defaultThresholds || {};
const DIRECTIONS = shared.signalThresholdDirections || {};

/** @type {Record<string, { label: string, unit: string, min: number, max: number, step: number }>} */
const SIGNAL_UI = {
  accuracy: { label: "Accuracy", unit: "%", min: 0, max: 100, step: 1 },
  safety: { label: "Safety", unit: "%", min: 0, max: 100, step: 1 },
  tone: { label: "Tone", unit: "%", min: 0, max: 100, step: 1 },
  hallucination: { label: "Hallucination", unit: "%", min: 0, max: 100, step: 1 },
  relevance: { label: "Relevance", unit: "%", min: 0, max: 100, step: 1 },
  smoke: { label: "Smoke tests", unit: "%", min: 0, max: 100, step: 1 },
  e2e_regression: { label: "E2E regression", unit: "%", min: 0, max: 100, step: 1 },
  crashrate: { label: "Crash rate", unit: "%", min: 0, max: 5, step: 0.01 },
  errorrate: { label: "Error rate", unit: "%", min: 0, max: 10, step: 0.01 },
  anrrate: { label: "ANR rate", unit: "%", min: 0, max: 2, step: 0.01 },
  oomrate: { label: "OOM rate", unit: "%", min: 0, max: 2, step: 0.01 },
  startup: { label: "Cold startup time", unit: "s", min: 0, max: 10, step: 0.1 },
  screenload: { label: "Key screen load", unit: "s", min: 0, max: 5, step: 0.1 },
  fps: { label: "Frame rate", unit: "fps", min: 30, max: 120, step: 1 },
  jserrors: { label: "JS error rate", unit: "%", min: 0, max: 5, step: 0.01 },
  p95latency: { label: "API p95 latency", unit: "ms", min: 0, max: 2000, step: 5 },
  p99latency: { label: "API p99 latency", unit: "ms", min: 0, max: 5000, step: 5 },
  errorunderload: { label: "Error rate under load", unit: "%", min: 0, max: 10, step: 0.1 },
  recovery: { label: "Stress recovery time", unit: "s", min: 0, max: 120, step: 1 },
  manual_qa_pct: { label: "Acceptable pass rate", unit: "%", min: 0, max: 100, step: 1 },
  manual_qa_worst_severity: { label: "Worst defect severity", unit: "", min: 0, max: 5, step: 1 }
};

/** Demo defaults when simulating passing values. */
const DEMO_PASSING = {
  accuracy: 88,
  safety: 91,
  tone: 86,
  hallucination: 93,
  relevance: 86,
  smoke: 100,
  e2e_regression: 97,
  crashrate: 0.06,
  errorrate: 0.45,
  anrrate: 0.02,
  oomrate: 0.08,
  startup: 2.4,
  screenload: 1.1,
  fps: 61,
  jserrors: 0.2,
  p95latency: 240,
  p99latency: 480,
  errorunderload: 0.4,
  recovery: 17,
  manual_qa_pct: 97,
  manual_qa_worst_severity: "none"
};

/** @param {string} signalId */
function buildSliderSignal(signalId) {
  const ui = SIGNAL_UI[signalId] || { label: signalId, unit: "", min: 0, max: 100, step: 1 };
  const dir = DIRECTIONS[signalId] || getSignalThresholdDirection(signalId);
  const lowerIsBetter = dir === "max";
  return {
    id: signalId,
    label: ui.label,
    type: "slider",
    min: ui.min,
    max: ui.max,
    step: ui.step,
    unit: ui.unit,
    lowerIsBetter,
    default: DEMO_PASSING[signalId] ?? DEFAULTS[signalId] ?? ui.min,
    threshold: DEFAULTS[signalId]
  };
}

/** @param {string} signalId */
function buildSeveritySignal(signalId) {
  return {
    id: signalId,
    label: SIGNAL_UI[signalId]?.label || "Worst defect severity",
    type: "severity",
    options: SEVERITY_LEVELS,
    default: DEMO_PASSING[signalId] ?? "none",
    thresholdMax: showstopperLabelToMaxWorstIndex("P0"),
    thresholdLabel: "P0",
    hardGate: true
  };
}

/** @param {string[]} signalIds */
function signalsFromIds(signalIds) {
  return signalIds.map((id) =>
    id === "manual_qa_worst_severity" ? buildSeveritySignal(id) : buildSliderSignal(id)
  );
}

/** Full simulator source catalog — aligned with shared signalSourceMap. */
export const SIMULATOR_SOURCES = [
  {
    id: "braintrust",
    name: "Braintrust",
    icon: "◐",
    color: "#f97316",
    glow: "rgba(249,115,22,0.18)",
    description: "AI eval scores from Braintrust experiments",
    tag: "AI Eval Quality",
    signals: signalsFromIds(shared.signalSourceMap.braintrust || [])
  },
  {
    id: "browserstack",
    name: "BrowserStack",
    icon: "◎",
    color: "#6366f1",
    glow: "rgba(99,102,241,0.18)",
    description: "Smoke and E2E regression pass rates",
    tag: "Delivery Reliability",
    signals: signalsFromIds(shared.signalSourceMap.browserstack || [])
  },
  {
    id: "sentry",
    name: "Sentry",
    icon: "◈",
    color: "#f87171",
    glow: "rgba(248,113,113,0.18)",
    description: "Crash, error, ANR, and OOM rates",
    tag: "Runtime Reliability",
    signals: signalsFromIds(shared.signalSourceMap.sentry || [])
  },
  {
    id: "datadog",
    name: "Datadog",
    icon: "▣",
    color: "#34d399",
    glow: "rgba(52,211,153,0.18)",
    description: "Startup, screen load, FPS, latency, and load signals",
    tag: "Runtime Performance",
    signals: signalsFromIds(shared.signalSourceMap.datadog || [])
  },
  {
    id: "manual_qa",
    name: "Manual QA",
    icon: "◇",
    color: "#f59e0b",
    glow: "rgba(245,158,11,0.18)",
    description: "Structured manual validation pass rate and showstopper severity",
    tag: "Risk Scenario Review",
    signals: signalsFromIds(shared.signalSourceMap.manual_qa || [])
  }
];

/** Read UI threshold state from localStorage (App → Thresholds). */
export function readLocalThresholdUiState() {
  try {
    const raw = localStorage.getItem("vdk3_thresholds");
    return raw ? { ...getDefaultThresholdUiState(), ...JSON.parse(raw) } : getDefaultThresholdUiState();
  } catch {
    return getDefaultThresholdUiState();
  }
}

/**
 * Apply workspace threshold values onto simulator signal defs.
 * @param {typeof SIMULATOR_SOURCES} sources
 * @param {Record<string, object>} thresholdMap
 * @param {Record<string, unknown>} [uiThresholds]
 */
export function applySimulatorThresholds(sources, thresholdMap, uiThresholds = readLocalThresholdUiState()) {
  const showstopper = uiThresholds.manual_qa_showstopper ?? "P0";
  const maxWorst = thresholdBoundsToScalar("manual_qa_worst_severity", thresholdMap?.manual_qa_worst_severity)
    ?? showstopperLabelToMaxWorstIndex(showstopper);

  return sources.map((src) => ({
    ...src,
    signals: src.signals.map((sig) => {
      if (sig.type === "severity") {
        return {
          ...sig,
          thresholdMax: maxWorst,
          thresholdLabel: showstopper
        };
      }
      const scalar = thresholdBoundsToScalar(sig.id, thresholdMap?.[sig.id]);
      const threshold = scalar != null ? scalar : sig.threshold;
      return { ...sig, threshold };
    })
  }));
}

/** @param {object} sig */
export function passesSimulatorSignal(sig, value) {
  if (sig.type === "severity") {
    const idx = typeof value === "number" ? value : severityToIndex(value);
    return passesShowstopperGate(idx, sig.thresholdMax);
  }
  if (sig.lowerIsBetter) return Number(value) <= Number(sig.threshold);
  return Number(value) >= Number(sig.threshold);
}

/** @param {object} sig @param {number|string} v */
export function formatSimulatorValue(sig, v) {
  if (sig.type === "severity") {
    const label = typeof v === "number" ? SEVERITY_LEVELS[v] ?? String(v) : String(v);
    return label === "none" ? "No defects" : label;
  }
  if (sig.unit === "%") {
    return sig.step < 1 ? `${Number(v).toFixed(2)}%` : `${Number(v).toFixed(0)}%`;
  }
  if (sig.unit === "ms") return `${Number(v).toFixed(0)}ms`;
  if (sig.unit === "s") return `${Number(v).toFixed(1)}s`;
  if (sig.unit === "fps") return `${Math.round(Number(v))}fps`;
  return String(v);
}

/**
 * Build numeric ingest payload for POST /api/releases/:id/signals.
 * @param {{ signals: Array<object> }} source
 * @param {Record<string, number|string>} values
 */
export function buildSimulatorIngestPayload(source, values) {
  const out = {};
  for (const sig of source.signals) {
    const raw = values[sig.id] ?? sig.default;
    if (sig.type === "severity") {
      out[sig.id] = typeof raw === "number" ? raw : severityToIndex(raw);
    } else {
      out[sig.id] = Number(raw);
    }
  }
  return out;
}

/** Default per-source value map for initial state. */
export function buildDefaultSimulatorValues(sources = SIMULATOR_SOURCES) {
  return Object.fromEntries(
    sources.map((src) => [
      src.id,
      Object.fromEntries(src.signals.map((sig) => [sig.id, sig.default]))
    ])
  );
}

export { SEVERITY_LEVELS, severityToIndex };
