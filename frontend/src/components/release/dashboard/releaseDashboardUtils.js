import { normalizeReleaseStatus, UI_RELEASE_STATUS, isLiveBypassRisk, shippedWithoutCertificationFlag } from "../../../lib/releaseStatus.js";

export function resolveDetailSuggestedActions(release, verdictIntel, recommendationIntel) {
  if (isLiveBypassRisk(release)) {
    if (Array.isArray(recommendationIntel?.suggested_actions) && recommendationIntel.suggested_actions.length) {
      return recommendationIntel.suggested_actions;
    }
    return null;
  }
  if (Array.isArray(verdictIntel?.recommended_actions) && verdictIntel.recommended_actions.length) {
    return verdictIntel.recommended_actions;
  }
  if (Array.isArray(recommendationIntel?.suggested_actions) && recommendationIntel.suggested_actions.length) {
    return recommendationIntel.suggested_actions;
  }
  return null;
}

export function verdictMeta(releaseOrStatus) {
  const release =
    releaseOrStatus && typeof releaseOrStatus === "object" ? releaseOrStatus : { status: releaseOrStatus };
  if (isLiveBypassRisk(release)) {
    const bypassed = shippedWithoutCertificationFlag(release);
    return {
      cls: "v-bypass",
      label: bypassed ? "GATE BYPASSED · LIVE" : "LIVE · UNCERTIFIED",
      pulse: true
    };
  }
  const s = normalizeReleaseStatus(release.status);
  if (s === UI_RELEASE_STATUS.CERTIFIED) return { cls: "v-cert", label: "CERTIFIED", pulse: false };
  if (s === UI_RELEASE_STATUS.CERTIFIED_WITH_OVERRIDE) return { cls: "v-ov", label: "WITH OVERRIDE", pulse: false };
  if (s === UI_RELEASE_STATUS.UNCERTIFIED) return { cls: "v-un", label: "UNCERTIFIED", pulse: false };
  if (s === UI_RELEASE_STATUS.COLLECTING) return { cls: "v-col", label: "COLLECTING", pulse: true };
  return { cls: "v-col", label: "COLLECTING", pulse: false };
}

export function envBucket(env) {
  const s = String(env || "").toLowerCase().trim();
  if (!s) return "pre-prod";
  if (s === "prod" || s === "production" || s === "main" || s === "master") return "prod";
  return "pre-prod";
}

export function envClass(env) {
  return envBucket(env) === "prod" ? "env-prod" : "env-pre";
}

export function envDisplayLabel(env) {
  return envBucket(env) === "prod" ? "prod" : "pre-prod";
}

export function reliabilityLabel(signalId) {
  const key = String(signalId || "").toLowerCase();
  if (key === "p95latency" || key === "p95_latency") return "latency p95";
  return key;
}

export function formatRelativeTimestamp(iso) {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return null;
  const diffMs = Date.now() - ts;
  if (diffMs < 0) return "just now";
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function evaluateSignalLocal(sig, value, threshold) {
  if (sig.direction === "test") {
    const v =
      value && typeof value === "object"
        ? value
        : typeof value === "number" && Number.isFinite(value)
          ? { rate: value, severity: "none" }
          : { rate: value === "pass" ? 100 : 0, severity: value === "pass" ? "none" : "P0" };
    const rate = v.rate ?? 0;
    const severity = v.severity ?? "none";
    const isP0 = severity === "P0";
    const ratePass = rate >= Number(threshold);
    return { pass: ratePass && !isP0 };
  }
  if (sig.direction === "pass") return { pass: value === "pass" };
  if (sig.direction === "above") return { pass: Number(value) >= Number(threshold) };
  if (sig.direction === "below") return { pass: Number(value) <= Number(threshold) };
  return { pass: false };
}

export function formatSignalValueLocal(sig, value) {
  if (value === undefined || value === null) return null;
  if (sig.direction === "test") {
    const v =
      value && typeof value === "object"
        ? value
        : typeof value === "number" && Number.isFinite(value)
          ? { rate: value, severity: "none" }
          : { rate: value === "pass" ? 100 : 0, severity: value === "pass" ? "none" : "P0" };
    const rate = v.rate ?? 0;
    const sev = v.severity ?? "none";
    return `${rate}%${sev !== "none" ? ` · ${sev}` : ""}`;
  }
  if (sig.direction === "pass") return value === "pass" ? "PASS" : "FAIL";
  const n = Number(value);
  if (Number.isNaN(n)) return String(value);
  if (sig.unit === "%") return (n < 10 && n !== Math.floor(n) ? n.toFixed(2) : n.toFixed(1)) + "%";
  if (sig.unit === "s") return n.toFixed(1) + "s";
  if (sig.unit === "ms") return Math.round(n) + "ms";
  if (sig.unit === "fps") return Math.round(n) + "fps";
  return String(value);
}

export function formatThresholdLineLocal(sig, threshold) {
  if (threshold === undefined || threshold === null) return "";
  if (sig.direction === "test") return `threshold ≥${threshold}% pass rate`;
  if (sig.direction === "above") return `threshold ≥${threshold}${sig.unit || ""}`;
  if (sig.direction === "below") return `threshold ≤${threshold}${sig.unit || ""}`;
  return "";
}

export function regressionRequiredLocal(releaseTypes, releaseTypeId) {
  const t = (releaseTypes || []).find((r) => r.id === releaseTypeId);
  if (t && Object.prototype.hasOwnProperty.call(t, "regressionRequired")) return t.regressionRequired;
  return null;
}

const DETAIL_SIGNAL_ORDER = ["accuracy", "safety", "hallucination", "relevance", "tone", "p95latency", "smoke", "e2e_regression"];

export function getOrderedDetailSignals(signalCategories) {
  const byId = new Map();
  for (const cat of signalCategories || []) {
    for (const sig of cat.signals || []) {
      if (!byId.has(sig.id)) byId.set(sig.id, { cat, sig });
    }
  }
  const out = [];
  for (const id of DETAIL_SIGNAL_ORDER) {
    if (byId.has(id)) out.push(byId.get(id));
  }
  return out;
}

export function gradeCls(g) {
  if (g === "A" || g === "A+") return "ga";
  if (String(g).startsWith("B")) return "gb";
  if (String(g).startsWith("C")) return "gc";
  return "gd";
}
