import shared from "../../../../shared/config.json";
import { SCREENSHOT_SIM_RELEASES } from "../screenshotSimReleases.js";
import { C } from "../../theme/tokens.js";

const NAV_TO_PATH = {
  release: "/releases",
  trend: "/trends",
  thresholds: "/thresholds",
  audit: "/audit"
};
const LEGACY_TAB_TO_PATH = {
  release: "/releases",
  trend: "/trends",
  thresholds: "/thresholds",
  audit: "/audit"
};
const S = {
  get: (k, d) => {
    try {
      const v = localStorage.getItem("vdk3_" + k);
      return v ? JSON.parse(v) : d;
    } catch {
      return d;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem("vdk3_" + k, JSON.stringify(v));
    } catch {
    }
  }
};
const nowTs = () => (/* @__PURE__ */ new Date()).toISOString().slice(0, 16).replace("T", " ");
const formatAuditTsFromIso = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso || "").slice(0, 16).replace("T", " ");
  return d.toISOString().slice(0, 16).replace("T", " ");
};
const humanizeAuditEventType = (t) => {
  if (!t) return "";
  return String(t).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
};
const auditDetailsToDetailString = (details) => {
  if (!details || typeof details !== "object") return "";
  if (typeof details.from_status === "string" && typeof details.to_status === "string" && typeof details.summary === "string") {
    return details.summary;
  }
  if (typeof details.note === "string") return details.note;
  if (typeof details.message === "string") return details.message;
  if (typeof details.summary === "string") return details.summary;
  if (typeof details.justification === "string" && details.justification.length < 400) return details.justification;
  try {
    const s = JSON.stringify(details);
    return s.length > 280 ? s.slice(0, 277) + "…" : s;
  } catch {
    return "";
  }
};
const mapWorkspaceAuditEventsToLog = (events) => {
  if (!Array.isArray(events)) return [];
  return events.map((e, idx) => {
    let details = e.details;
    if ((!details || typeof details !== "object") && typeof e.details_json === "string") {
      try {
        details = JSON.parse(e.details_json || "{}");
      } catch {
        details = {};
      }
    }
    if (!details || typeof details !== "object") details = {};
    const releaseRef = typeof details.release_ref === "string" ? details.release_ref : null;
    const version = typeof details.version === "string" ? details.version : null;
    const rid = e.release_id || null;
    return {
      id: `srv-${idx}-${e.created_at || idx}`,
      ts: formatAuditTsFromIso(e.created_at),
      event: humanizeAuditEventType(e.event_type),
      _rawEventType: e.event_type,
      release: version || releaseRef || (rid ? `Release …${String(rid).slice(-6)}` : "—"),
      backendReleaseId: rid,
      actor: e.actor_name || e.actor_type || "System",
      detail: auditDetailsToDetailString(details)
    };
  });
};
const verdictIntelligenceSourceLine = (verdictIntel) => {
  const src = String(verdictIntel?.source || "");
  const model = String(verdictIntel?.model || "");
  const looksGemini = /gemini/i.test(src) || /gemini/i.test(model) || /^assistive_/i.test(src) && !/deterministic/i.test(src);
  if (looksGemini)
    return {
      label: "Source: Gemini-enriched",
      hint: "Verdict from rules; summary wording refined by the model.",
      shortLine: "Verdict from rules; summary wording may be model-polished."
    };
  return {
    label: "Source: Deterministic",
    hint: "Verdict and brief from rules only (no LLM rewrite).",
    shortLine: "Rules-only verdict and brief (no LLM rewrite)."
  };
};
const isMobileViewport = () => window.innerWidth <= 900;
const formatReleaseDisplayName = (version) => {
  const v = String(version || "").trim();
  if (!v) return "—";
  const e2e = v.match(/^([\d.]+)-e2e-(\d+)$/);
  if (e2e) return `${e2e[1]} · ${e2e[2].slice(-6)}`;
  if (v.includes("·") || v.includes("•")) {
    const parts = v.split(/[·•]/).map((s) => s.trim()).filter(Boolean);
    if (parts.length > 1) {
      const last = parts[parts.length - 1];
      const sem = last.match(/(\d+\.\d+\.\d+)/);
      if (sem) return sem[1];
      if (last.length <= 16) return last;
      return last.length > 12 ? `${last.slice(0, 5)}…${last.slice(-5)}` : last;
    }
  }
  const semvers = v.match(/\d+\.\d+\.\d+/g);
  if (semvers && semvers.length) return semvers[semvers.length - 1];
  const longTail = v.match(/(\d{5,})$/);
  if (longTail) return `…${longTail[1].slice(-6)}`;
  if (v.length <= 18) return v;
  return `${v.slice(0, 6)}…${v.slice(-4)}`;
};
function releaseVersionPrimarySecondary(version) {
  const raw = String(version || "").trim();
  if (!raw) return { primary: "—", secondary: null, fullTitle: "" };
  const m = raw.match(/^(v?\d+\.\d+\.\d+)/i);
  if (m) {
    let tail = raw.slice(m[0].length).replace(/^[\s·•\-–]+/, "").trim();
    return {
      primary: m[0],
      secondary: tail || null,
      fullTitle: raw
    };
  }
  return { primary: formatReleaseDisplayName(version), secondary: null, fullTitle: raw };
}
const TREND_CHART_MAX_POINTS = 18;
const trendChartXLabel = (index, totalPoints) => {
  if (totalPoints <= 1) return "R1";
  const every = Math.max(1, Math.ceil(totalPoints / 7));
  if (index % every !== 0 && index !== totalPoints - 1) return "";
  return `R${index + 1}`;
};
const DEFAULT_ROLE_POLICY = {
  ai_product_lead: { label: "AI Product Lead", title: "AI Product Lead", canOverride: false, canAct: true, color: C.cyan },
  ml_engineer: { label: "ML / AI Engineer", title: "ML / AI Engineer", canOverride: false, canAct: true, color: C.green },
  engineer: { label: "Engineer", title: "Engineer", canOverride: false, canAct: false, color: C.muted },
  qe_lead: { label: "QE Leader", title: "QE Lead", canOverride: false, canAct: true, color: C.accent },
  tech_lead: { label: "Tech Lead", title: "Tech Lead", canOverride: false, canAct: true, color: C.green },
  release_manager: { label: "Release Manager", title: "Release Manager", canOverride: false, canAct: true, color: C.amber },
  vp_engineering: { label: "VP Engineering", title: "VP Engineering", canOverride: true, canAct: true, color: C.accent },
  cto: { label: "CTO / Founder", title: "CTO / Founder", canOverride: true, canAct: true, color: C.pink }
};
const ROLES = (() => {
  try {
    const policy = JSON.parse(localStorage.getItem("vdk3_role_policy") || "{}");
    const entries = Object.entries(policy);
    if (!entries.length) return DEFAULT_ROLE_POLICY;
    return {
      ...DEFAULT_ROLE_POLICY,
      ...Object.fromEntries(entries.map(([id, cfg]) => [id, {
        ...DEFAULT_ROLE_POLICY[id],
        ...cfg,
        color: cfg?.color || DEFAULT_ROLE_POLICY[id]?.color || C.muted
      }]))
    };
  } catch {
    return DEFAULT_ROLE_POLICY;
  }
})();
const canAct = (user) => !user || ROLES[user?.role]?.canAct !== false;
const RELEASE_TYPES = shared.releaseTypes;
const getRegressionRequired = (releaseType) => {
  const t = RELEASE_TYPES.find((r) => r.id === releaseType);
  return t ? t.regressionRequired : null;
};
const SIGNAL_CATEGORIES = [{
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
const DEFAULT_THRESHOLDS = {
  ...shared.defaultThresholds
};
/** Local-only demo rows (also default seed when `vdk3_releases` is empty). */
const DEMO_RELEASES = SCREENSHOT_SIM_RELEASES;
const DEFAULT_AUDIT = [{
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
const INFRA_ITEMS = [{
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
const SEVERITIES = ["none", "P4", "P3", "P2", "P1", "P0"];
const severityRank = (s) => SEVERITIES.indexOf(s ?? "none");
const evaluateSignal = (sig, value, threshold) => {
  if (sig.direction === "test") {
    const v = value && typeof value === "object" ? value : { rate: value === "pass" ? 100 : 0, severity: value === "pass" ? "none" : "P0" };
    const rate = v.rate ?? 0;
    const severity = v.severity ?? "none";
    const isP0 = severity === "P0";
    const ratePass = rate >= Number(threshold);
    return { pass: ratePass && !isP0, isHardGate: isP0 };
  }
  if (sig.direction === "pass") return {
    pass: value === "pass",
    isHardGate: !!sig.hardGate
  };
  if (sig.direction === "above") return {
    pass: Number(value) >= Number(threshold),
    isHardGate: !!sig.hardGate
  };
  if (sig.direction === "below") return {
    pass: Number(value) <= Number(threshold),
    isHardGate: !!sig.hardGate
  };
  return {
    pass: false,
    isHardGate: false
  };
};
const SIGNAL_SOURCES = [
  { id: "browserstack", name: "BrowserStack", icon: "◎", color: "#f87171", signals: ["smoke", "e2e_regression"], demoValues: { smoke: { rate: 100, severity: "none" }, e2e_regression: { rate: 97, severity: "P4" } } },
  { id: "sentry", name: "Sentry", icon: "⚡", color: "#fb923c", signals: ["crashrate", "anrrate", "errorrate", "oomrate"], demoValues: { crashrate: 0.07, anrrate: 0.03, errorrate: 0.5, oomrate: 0.1 } },
  { id: "datadog", name: "Datadog", icon: "◈", color: "#60a5fa", signals: ["startup", "screenload", "fps", "jserrors", "p95latency", "p99latency", "errorunderload", "recovery"], demoValues: { startup: 2.3, screenload: 1, fps: 62, jserrors: 0.2, p95latency: 210, p99latency: 430, errorunderload: 0.4, recovery: 17 } },
  { id: "braintrust", name: "Braintrust", icon: "◐", color: "#f472b6", signals: ["accuracy", "safety", "tone", "hallucination", "relevance"], demoValues: { accuracy: 89, safety: 91, tone: 93, hallucination: 96, relevance: 87 } }
];
const mapBackendDetailToUi = (detail) => {
  const release = detail.release;
  const bid = release.id;
  const signals = {};
  for (const s of detail.signals || []) {
    signals[s.signal_id] = s.value;
  }
  const statusMap = {
    COLLECTING: "collecting",
    UNCERTIFIED: "pending",
    CERTIFIED: "shipped",
    CERTIFIED_WITH_OVERRIDE: "overridden"
  };
  const out = {
    id: `rc-${bid.replace(/\W/g, "")}`,
    backendReleaseId: bid,
    version: release.version,
    date: (release.created_at || "").slice(0, 10) || (/* @__PURE__ */ new Date()).toISOString().slice(0, 10),
    releaseType: release.release_type || "model_update",
    status: statusMap[release.status] || "pending",
    signals,
    sources: release.status === "COLLECTING" ? SIGNAL_SOURCES.map((s) => ({ ...s, status: "waiting" })) : []
  };
  if (release.environment) out.buildRef = release.environment;
  if (detail.override) {
    out.overrideBy = detail.override.approver_name;
    out.overrideReason = detail.override.justification;
  }
  if (detail.intelligence) {
    out.intelligence = detail.intelligence;
  }
  if (release.created_at) out.created_at = release.created_at;
  if (release.updated_at) out.updated_at = release.updated_at;
  if (release.verdict_issued_at) out.verdict_issued_at = release.verdict_issued_at;
  if (detail.last_signal_evaluation && typeof detail.last_signal_evaluation === "object") {
    out.last_signal_evaluation = detail.last_signal_evaluation;
  }
  if (Array.isArray(detail.deltas) && detail.deltas.length) {
    out.release_deltas = detail.deltas;
  }
  return out;
};
const parseSemverish = (v) => {
  const m = String(v || "").match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)];
};
const semverDesc = (va, vb) => {
  const a = parseSemverish(va);
  const b = parseSemverish(vb);
  if (a && b) {
    for (let i = 0; i < 3; i++) {
      if (a[i] !== b[i]) return b[i] - a[i];
    }
  }
  return String(vb || "").localeCompare(String(va || ""));
};
const releaseSortTimestampMs = (r) => {
  if (!r) return null;
  const tryParse = (s) => {
    if (!s || typeof s !== "string") return NaN;
    return Date.parse(s.length > 10 ? s : s + "T12:00:00.000Z");
  };
  for (const key of ["created_at", "updated_at", "verdict_issued_at"]) {
    const ms = tryParse(r[key]);
    if (!Number.isNaN(ms)) return ms;
  }
  const dms = tryParse(r.date);
  if (!Number.isNaN(dms)) return dms;
  const bid = typeof r.backendReleaseId === "string" ? r.backendReleaseId : "";
  const m = bid.match(/rel_(\d{10,})/);
  if (m) return parseInt(m[1], 10);
  return null;
};
const sidebarStatusLabel = (status) => {
  if (status === "shipped") return "Certified";
  if (status === "overridden") return "Override";
  if (status === "blocked") return "Blocked";
  if (status === "collecting") return "Collecting";
  if (status === "pending") return "In review";
  return status ? String(status) : "—";
};
const formatSidebarReleaseAge = (r) => {
  const ms = releaseSortTimestampMs(r);
  if (ms == null || Number.isNaN(ms)) {
    return r.date && typeof r.date === "string" ? r.date : "";
  }
  const diff = Date.now() - ms;
  if (diff < 0) return new Date(ms).toLocaleDateString(void 0, { month: "short", day: "numeric" });
  const sec = Math.floor(diff / 1e3);
  if (sec < 45) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return min + "m ago";
  const hr = Math.floor(min / 60);
  if (hr < 36) return hr + "h ago";
  const day = Math.floor(hr / 24);
  if (day < 14) return day + "d ago";
  const opts = { month: "short", day: "numeric" };
  if (ms < Date.now() - 365 * 864e5) opts.year = "numeric";
  return new Date(ms).toLocaleDateString(void 0, opts);
};
const releaseDayKeyLocal = (r) => {
  const ms = releaseSortTimestampMs(r);
  if (ms != null && !Number.isNaN(ms)) {
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  if (r.date && typeof r.date === "string" && r.date.length >= 10) return r.date.slice(0, 10);
  return "unknown";
};
const formatSidebarDayHeading = (dayKey) => {
  if (dayKey === "unknown") return "Date unknown";
  const parts = dayKey.split("-").map((x) => parseInt(x, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return dayKey;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  const now = /* @__PURE__ */ new Date();
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((start(now) - start(d)) / 864e5);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays > 1 && diffDays < 7) return d.toLocaleDateString(void 0, { weekday: "long", month: "short", day: "numeric" });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(void 0, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: sameYear ? void 0 : "numeric"
  });
};
const getLastCertified = (releases) => {
  return releases.find((r) => r.status === "shipped" || r.status === "overridden") || null;
};
const calcVerdict = (signals, thresholds, releaseType, prevSigs = null) => {
  const failing = [];
  const hardGateFails = [];
  const reqd = getRegressionRequired(releaseType);
  SIGNAL_CATEGORIES.forEach((cat) => {
    cat.signals.forEach((sig) => {
      const val = signals[sig.id];
      if (sig.conditional) {
        if (val === null || val === void 0) return;
        if (reqd === false) return;
      }
      if (val === void 0 || val === null) return;
      const {
        pass,
        isHardGate
      } = evaluateSignal(sig, val, thresholds[sig.id]);
      if (!pass) {
        failing.push({
          catId: cat.id,
          catLabel: cat.label,
          sigId: sig.id,
          sigLabel: sig.label,
          value: val,
          threshold: thresholds[sig.id],
          direction: sig.direction,
          unit: sig.unit,
          isHardGate
        });
        if (isHardGate) hardGateFails.push({
          catLabel: cat.label,
          sigLabel: sig.label
        });
      }
    });
  });
  if (prevSigs) {
    SIGNAL_CATEGORIES.forEach((cat) => {
      cat.signals.forEach((sig) => {
        if (!sig.hasDelta) return;
        const val = signals[sig.id];
        const prev = prevSigs[sig.id];
        if (val === void 0 || val === null || prev === void 0 || prev === null) return;
        const maxDrop = thresholds[sig.id + "_delta"];
        if (maxDrop === void 0) return;
        const drop = Number(prev) - Number(val);
        if (drop > maxDrop) {
          const alreadyFailing = failing.some((f) => f.sigId === sig.id);
          if (!alreadyFailing) {
            failing.push({
              catId: cat.id,
              catLabel: cat.label,
              sigId: sig.id,
              sigLabel: sig.label,
              value: val,
              threshold: thresholds[sig.id],
              direction: sig.direction,
              unit: sig.unit,
              isHardGate: false,
              isDeltaFail: true,
              drop: +drop.toFixed(1),
              maxDrop,
              prevVal: prev
            });
          }
        }
      });
    });
  }
  return {
    recommendation: failing.length === 0 ? "SHIP" : "BLOCK",
    failing,
    hardGateFails,
    isHardBlock: hardGateFails.length > 0
  };
};
const calcCategoryStatus = (catId, signals, thresholds, releaseType) => {
  const cat = SIGNAL_CATEGORIES.find((c) => c.id === catId);
  if (!cat) return "unknown";
  const reqd = getRegressionRequired(releaseType);
  const results = cat.signals.map((sig) => {
    const val = signals[sig.id];
    if (sig.conditional && (val === null || val === void 0 || reqd === false)) return "waived";
    if (val === void 0 || val === null) return null;
    return evaluateSignal(sig, val, thresholds[sig.id]).pass;
  }).filter((r) => r !== null);
  if (results.length === 0) return "missing";
  if (results.some((r) => r === false)) return "fail";
  if (results.some((r) => r === "waived")) return "waived";
  return "pass";
};
const fmtVal = (sig, val) => {
  if (val === null || val === void 0) return "WAIVED";
  if (sig.direction === "test") {
    const v = val && typeof val === "object" ? val : { rate: val === "pass" ? 100 : 0, severity: val === "pass" ? "none" : "P0" };
    const sev = v.severity ?? "none";
    return `${v.rate ?? 0}% · ${sev === "none" ? "all pass" : sev + " failing"}`;
  }
  if (sig.direction === "pass") return val === "pass" ? "PASS" : "FAIL";
  const n = Number(val);
  if (sig.unit === "%") return n.toFixed(n < 10 ? 2 : 1) + "%";
  if (sig.unit === "s") return n.toFixed(1) + "s";
  if (sig.unit === "ms") return Math.round(n) + "ms";
  if (sig.unit === "fps") return Math.round(n) + "fps";
  return String(val);
};
const signalColor = (sig, val, threshold) => {
  if (val === null || val === void 0) return C.amber;
  if (sig.direction === "test") return evaluateSignal(sig, val, threshold).pass ? C.green : C.red;
  if (sig.direction === "pass") return val === "pass" ? C.green : C.red;
  const pass = sig.direction === "above" ? Number(val) >= Number(threshold) : Number(val) <= Number(threshold);
  if (pass) {
    const margin = sig.direction === "above" ? (Number(val) - Number(threshold)) / Number(threshold) * 100 : (Number(threshold) - Number(val)) / Number(threshold) * 100;
    return margin < 10 ? C.amber : C.green;
  }
  return C.red;
};
const catStatusColor = (s) => s === "pass" ? C.green : s === "fail" ? C.red : s === "waived" ? C.amber : C.dim;
const findSignalMetaById = (signalId) => {
  for (const c of SIGNAL_CATEGORIES) {
    const s = c.signals.find((x) => x.id === signalId);
    if (s) return s;
  }
  return null;
};
const formatAiPct = (n) => {
  if (n == null || !Number.isFinite(Number(n))) return "—";
  return `${Math.round(Number(n))}%`;
};
const formatDeltaBaselineVersionPill = (v) => {
  if (v == null || v === "") return null;
  const t = String(v).trim();
  if (!t) return null;
  return t.startsWith("v") ? t : `v${t}`;
};
const buildRegressionOverrideContext = (deltas) => {
  const rows = Array.isArray(deltas) ? deltas : [];
  const regressionRows = rows.filter((d) => d.passed === false && !d.no_baseline);
  if (!regressionRows.length) {
    return {
      regressionRows: [],
      justification: "",
      suggestedImpact: ""
    };
  }
  const headlineLines = regressionRows.map((d) => {
    const meta = findSignalMetaById(d.signal_id);
    const title = meta ? meta.label : d.signal_id;
    const b = Number(d.baseline_value);
    const c = Number(d.current_value);
    const pts = d.drop_amount != null && Number.isFinite(Number(d.drop_amount)) ? Number(d.drop_amount).toFixed(1) : "?";
    return `${title} dropped ${pts} points from the last certified release (${formatAiPct(b)} → ${formatAiPct(c)}).`;
  });
  const justification = ["Regression detected", ...headlineLines.map((l) => `• ${l}`), "", "Please explain why this regression is acceptable and what mitigation plan you have."].join("\n");
  const labels = regressionRows.map((r) => findSignalMetaById(r.signal_id)?.label || r.signal_id);
  const suggestedImpact = `Regression affects AI quality (${labels.join(", ")}). Describe user impact and scope.`;
  return {
    regressionRows,
    justification,
    suggestedImpact
  };
};
const scoreJustification = (text) => {
  const t = text.toLowerCase().trim();
  const len = t.length;
  const hasImpact = /user.?impact|no.?impact|low.?risk|isolated|contained|affect|users|customer|session|critical|urgent/.test(t);
  const hasMitigation = /monitor|watch|revert|rollback|hotfix|fix|patch|committed|will|plan|next.?release|follow.?up|feature.?flag/.test(t);
  const hasSpecific = /v\d|\d+\s*%|signal|sentry|datadog|test|e2e|regression|ticket|issue|pr\s*#|\d{3,}|toggle|flag/.test(t);
  const score = (hasImpact ? 1 : 0) + (hasMitigation ? 1 : 0) + (hasSpecific ? 1 : 0);
  if (len < 40 || score === 0) return { grade: "WEAK", color: C.red, note: "Too vague — add specific context about user impact, the risk, and any mitigation steps." };
  if (score <= 1 || len < 100) return { grade: "ACCEPTABLE", color: C.amber, note: "Adequate — a stronger record includes risk acknowledgement and a concrete mitigation commitment." };
  return { grade: "STRONG", color: C.green, note: "Well documented — this justification will hold up under audit review." };
};
const releaseRiskScore = (r, thresholds) => {
  if (r.status === "blocked") return { level: "HIGH RISK", color: C.red };
  if (r.status === "overridden") return { level: "OVERRIDDEN", color: C.amber };
  let nearMiss = 0;
  SIGNAL_CATEGORIES.flatMap((c) => c.signals).forEach((sig) => {
    const val = r.signals[sig.id];
    if (val === null || val === void 0) return;
    const th = thresholds[sig.id];
    if (!th) return;
    const { pass } = evaluateSignal(sig, val, th);
    if (pass) {
      const margin = sig.direction === "above" ? val / th - 1 : 1 - val / th;
      if (margin < 0.12) nearMiss++;
    }
  });
  if (nearMiss >= 2) return { level: "BORDERLINE", color: C.amber };
  return null;
};
const genCertSummary = (release, failing, isShip) => {
  const rt = RELEASE_TYPES.find((r) => r.id === release.releaseType);
  const rtLabel = rt ? rt.label.toLowerCase() : "release";
  const totalSigs = SIGNAL_CATEGORIES.flatMap((c) => c.signals).length;
  const passCount = totalSigs - failing.length;
  if (isShip && release.status === "shipped") {
    return `${release.version} is a ${rtLabel} that passed all ${totalSigs} quality signals and was certified on ${release.date}. ${passCount} of ${totalSigs} signals met or exceeded threshold. No overrides were required. This release is on permanent record as fully certified.`;
  }
  if (release.status === "overridden") {
    const weakest = failing[0];
    return `${release.version} shipped as CERTIFIED WITH OVERRIDE on ${release.date}. ${passCount} of ${totalSigs} signals passed, but ${failing.length} signal${failing.length > 1 ? "s" : ""} — including ${weakest ? weakest.catLabel : "one category"} — fell below threshold. An override was recorded with a named owner and written justification permanently on record.`;
  }
  if (release.status === "blocked") {
    return `${release.version} is UNCERTIFIED. ${failing.length} signal${failing.length > 1 ? "s" : ""} failed to meet threshold and a hard gate prevented override. This release cannot ship until the failing signals are resolved.`;
  }
  return `${release.version} is pending certification. ${passCount} of ${totalSigs} signals are currently passing. ${failing.length > 0 ? `${failing.length} signal${failing.length > 1 ? "s" : ""} require attention before a verdict can be issued.` : "All signals are meeting threshold."}`;
};

export {
  NAV_TO_PATH,
  LEGACY_TAB_TO_PATH,
  S,
  nowTs,
  formatAuditTsFromIso,
  humanizeAuditEventType,
  auditDetailsToDetailString,
  mapWorkspaceAuditEventsToLog,
  verdictIntelligenceSourceLine,
  isMobileViewport,
  formatReleaseDisplayName,
  releaseVersionPrimarySecondary,
  trendChartXLabel,
  TREND_CHART_MAX_POINTS,
  DEFAULT_ROLE_POLICY,
  ROLES,
  canAct,
  RELEASE_TYPES,
  getRegressionRequired,
  SIGNAL_CATEGORIES,
  DEFAULT_THRESHOLDS,
  DEMO_RELEASES,
  DEFAULT_AUDIT,
  INFRA_ITEMS,
  SEVERITIES,
  severityRank,
  evaluateSignal,
  SIGNAL_SOURCES,
  mapBackendDetailToUi,
  parseSemverish,
  semverDesc,
  releaseSortTimestampMs,
  sidebarStatusLabel,
  formatSidebarReleaseAge,
  releaseDayKeyLocal,
  formatSidebarDayHeading,
  getLastCertified,
  calcVerdict,
  calcCategoryStatus,
  fmtVal,
  signalColor,
  catStatusColor,
  findSignalMetaById,
  formatAiPct,
  formatDeltaBaselineVersionPill,
  buildRegressionOverrideContext,
  scoreJustification,
  releaseRiskScore,
  genCertSummary
};

