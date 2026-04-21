import shared from "../../../shared/config.json";
import { C } from "../theme/tokens.js";

export const RELEASE_TYPES = shared.releaseTypes;

export const getRegressionRequired = (releaseType) => {
  const t = RELEASE_TYPES.find((r) => r.id === releaseType);
  return t ? t.regressionRequired : null;
};

export const SIGNAL_CATEGORIES = [{
  id: "tests",
  label: "Delivery Reliability",
  icon: "✦",
  color: C.cyan,
  dimColor: C.cyanDim,
  description: "Smoke (always) · Human validation declaration · E2E regression (conditional on release type)",
  signals: [{
    id: "smoke",
    label: "Smoke tests",
    direction: "test",
    unit: "%",
    hardGate: false,
    conditional: false,
    description: "Pass rate must meet floor. Any P0 failure is a hard block — no override. P1+ failures are overridable if rate meets threshold."
  }, {
    id: "e2e_regression",
    label: "E2E regression",
    direction: "test",
    unit: "%",
    hardGate: false,
    conditional: true,
    description: "Required for prompt/UX updates. Waivable for model patches and safety hotfixes. P0 failure = hard block. P3/P4 below threshold = overridable."
  }]
}, {
  id: "performance",
  label: "Runtime Performance",
  icon: "◎",
  color: C.accent,
  dimColor: C.accentDim,
  description: "Non-AI delivery gate: responsiveness and behaviour under load",
  signals: [{
    id: "startup",
    label: "Cold startup time",
    direction: "below",
    unit: "s",
    hardGate: false,
    conditional: false,
    description: "Time to interactive from cold launch"
  }, {
    id: "screenload",
    label: "Key screen load",
    direction: "below",
    unit: "s",
    hardGate: false,
    conditional: false,
    description: "Primary screen render time"
  }, {
    id: "fps",
    label: "Frame rate",
    direction: "above",
    unit: "fps",
    hardGate: false,
    conditional: false,
    description: "Average FPS during key interactions"
  }, {
    id: "jserrors",
    label: "JS error rate",
    direction: "below",
    unit: "%",
    hardGate: false,
    conditional: false,
    description: "Uncaught JS errors per session"
  }, {
    id: "p95latency",
    label: "API p95 latency",
    direction: "below",
    unit: "ms",
    hardGate: false,
    conditional: false,
    description: "95th percentile API response time under load"
  }, {
    id: "p99latency",
    label: "API p99 latency",
    direction: "below",
    unit: "ms",
    hardGate: false,
    conditional: false,
    description: "99th percentile API response time under load"
  }, {
    id: "errorunderload",
    label: "Error rate under load",
    direction: "below",
    unit: "%",
    hardGate: false,
    conditional: false,
    description: "5xx rate at peak concurrent users"
  }, {
    id: "recovery",
    label: "Stress recovery time",
    direction: "below",
    unit: "s",
    hardGate: false,
    conditional: false,
    description: "Time to recover after stress test peak"
  }]
}, {
  id: "stability",
  label: "Runtime Reliability",
  icon: "◈",
  color: C.green,
  dimColor: C.greenDim,
  description: "Non-AI reliability gate: crash, error, and failure rate signals",
  signals: [{
    id: "crashrate",
    label: "Crash rate",
    direction: "below",
    unit: "%",
    hardGate: false,
    conditional: false,
    description: "Sessions ending in a crash"
  }, {
    id: "anrrate",
    label: "ANR rate",
    direction: "below",
    unit: "%",
    hardGate: false,
    conditional: false,
    description: "Android Not Responding rate"
  }, {
    id: "errorrate",
    label: "API error rate",
    direction: "below",
    unit: "%",
    hardGate: false,
    conditional: false,
    description: "5xx errors as % of total API calls"
  }, {
    id: "oomrate",
    label: "OOM rate",
    direction: "below",
    unit: "%",
    hardGate: false,
    conditional: false,
    description: "Out of memory events per session"
  }]
}, {
  id: "ai",
  label: "AI Eval Quality",
  icon: "◐",
  color: C.pink,
  dimColor: C.pinkDim,
  description: "Primary AI output quality gate (floor + max regression delta)",
  signals: [{
    id: "accuracy",
    label: "Accuracy",
    direction: "above",
    unit: "%",
    hardGate: false,
    conditional: false,
    hasDelta: true,
    description: "Factual correctness of AI responses — evaluated against floor and max regression from last certified release"
  }, {
    id: "safety",
    label: "Safety",
    direction: "above",
    unit: "%",
    hardGate: false,
    conditional: false,
    hasDelta: true,
    description: "Absence of harmful or prohibited content — evaluated against floor and max regression from last certified release"
  }, {
    id: "tone",
    label: "Tone",
    direction: "above",
    unit: "%",
    hardGate: false,
    conditional: false,
    hasDelta: true,
    description: "Appropriate brand voice and register — evaluated against floor and max regression from last certified release"
  }, {
    id: "hallucination",
    label: "Hallucination",
    direction: "above",
    unit: "%",
    hardGate: false,
    conditional: false,
    hasDelta: true,
    description: "Responses grounded in available context — evaluated against floor and max regression from last certified release"
  }, {
    id: "relevance",
    label: "Relevance",
    direction: "above",
    unit: "%",
    hardGate: false,
    conditional: false,
    hasDelta: true,
    description: "Response addresses user intent — evaluated against floor and max regression from last certified release"
  }]
}];

export const DEFAULT_THRESHOLDS = {
  ...shared.defaultThresholds
};

export { SCREENSHOT_SIM_RELEASES as DEMO_RELEASES, SCREENSHOT_GALLERY_DEMO_EMAIL, SCREENSHOT_SIM_RELEASES } from "./screenshotSimReleases.js";

export const DEFAULT_AUDIT = [{
  id: 8,
  ts: "2026-02-28 09:01",
  event: "Release candidate created",
  release: "v2.14.0",
  actor: "UAT Pipeline",
  detail: "Prompt / UX update. Smoke: PASS. E2E regression required and passed. All signals collected from UAT build tag build/2847."
}, {
  id: 7,
  ts: "2026-02-14 11:32",
  event: "Release shipped",
  release: "v2.13.0",
  actor: "Jordan Blake",
  detail: "Model patch — regression waived. Isolated handler fix, no flow changes. All other signals passed. PROD deploy unblocked."
}, {
  id: 6,
  ts: "2026-02-14 10:45",
  event: "Regression waived",
  release: "v2.13.0",
  actor: "Jordan Blake, QE Lead",
  detail: "E2E regression not required for this bug fix. Reason on permanent record."
}, {
  id: 5,
  ts: "2026-01-31 16:55",
  event: "Override approved",
  release: "v2.12.0",
  actor: "Alex Baird, VP Engineering",
  detail: "AI accuracy 79% below 85% threshold. Model update — regression waived. Override documented and signed."
}, {
  id: 4,
  ts: "2026-01-31 15:22",
  event: "Verdict: UNCERTIFIED",
  release: "v2.12.0",
  actor: "Verdikt",
  detail: "2 signals below threshold: accuracy 79% (needs ≥85%), relevance 74% (needs ≥82%). Smoke passed."
}, {
  id: 3,
  ts: "2026-01-03 10:15",
  event: "Verdict: UNCERTIFIED",
  release: "v2.10.0",
  actor: "Verdikt",
  detail: "Hard gate failure: smoke FAIL. Startup 4.2s > 3.0s. Crash rate 0.18% > 0.1%."
}, {
  id: 2,
  ts: "2026-01-03 09:55",
  event: "Release candidate created",
  release: "v2.10.0",
  actor: "UAT Pipeline",
  detail: "Prompt / UX update. Signals collected from UAT build tag build/2801. E2E regression required."
}];

export const INFRA_ITEMS = [{
  id: "eval_pipeline_wired",
  label: "AI eval pipeline connected",
  status: "pending",
  priority: "P0",
  description: "Connect your Braintrust or LangSmith eval project to Verdikt using version tags. Until this is wired, AI eval scores (accuracy, safety, tone, hallucination, relevance) cannot be certified against your defined thresholds.",
  owner: "",
  linkedTo: "braintrust-config.ts:1"
}, {
  id: "eval_thresholds_set",
  label: "AI eval thresholds configured",
  status: "pending",
  priority: "P0",
  description: "Set floor and max regression delta for each AI eval signal in Settings → Quality Thresholds → AI Evaluation. Thresholds are not advisory — they are enforced at every release. Without this, Verdikt cannot issue a certification verdict.",
  owner: "",
  linkedTo: "/settings"
}, {
  id: "release_gate",
  label: "Release gate active",
  status: "pending",
  priority: "P0",
  description: "After eval pipeline is connected and thresholds are set, enable the release gate so every model update and feature release requires a Verdikt certification verdict before shipping. Signal flow: eval run completes → version tag matched → verdict issued → override required if below threshold.",
  owner: "",
  linkedTo: "Settings → Trigger"
}];

export const SIGNAL_SOURCES = [
  { id: "browserstack", name: "BrowserStack", icon: "◎", color: "#f87171", signals: ["smoke", "e2e_regression"], demoValues: { smoke: { rate: 100, severity: "none" }, e2e_regression: { rate: 97, severity: "P4" } } },
  { id: "sentry", name: "Sentry", icon: "⚡", color: "#fb923c", signals: ["crashrate", "anrrate", "errorrate", "oomrate"], demoValues: { crashrate: 0.07, anrrate: 0.03, errorrate: 0.5, oomrate: 0.1 } },
  { id: "datadog", name: "Datadog", icon: "◈", color: "#60a5fa", signals: ["startup", "screenload", "fps", "jserrors", "p95latency", "p99latency", "errorunderload", "recovery"], demoValues: { startup: 2.3, screenload: 1, fps: 62, jserrors: 0.2, p95latency: 210, p99latency: 430, errorunderload: 0.4, recovery: 17 } },
  { id: "braintrust", name: "Braintrust", icon: "◐", color: "#f472b6", signals: ["accuracy", "safety", "tone", "hallucination", "relevance"], demoValues: { accuracy: 89, safety: 91, tone: 93, hallucination: 96, relevance: 87 } }
];
