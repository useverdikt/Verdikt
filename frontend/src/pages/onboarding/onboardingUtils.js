import { CATS, RTYPES } from "./onboardingConstants.js";

export function esc(v) {
  return String(v == null ? "" : v).replace(/[&<>"']/g, (ch) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])
  );
}

export function regReqd(rt) {
  const t = RTYPES.find((r) => r.id === rt);
  if (!t) return null;
  if (t.reg === "req") return true;
  if (t.reg === "wav") return false;
  return null;
}

export function evalSig(sig, val, thresh) {
  if (sig.dir === "test") {
    const v =
      val && typeof val === "object"
        ? val
        : { rate: val === "pass" ? 100 : 0, severity: val === "pass" ? "none" : "P0" };
    return (v.rate ?? 0) >= +thresh && v.severity !== "P0";
  }
  if (sig.dir === "pass") return val === "pass";
  if (sig.dir === "above") return +val >= +thresh;
  return +val <= +thresh;
}

export function calcV(rel, thresh) {
  const fail = [];
  const reqd = regReqd(rel.rtype);
  CATS.forEach((cat) =>
    cat.sigs.forEach((sig) => {
      const v = rel.sigs[sig.id];
      if (sig.cond && (v === null || v === undefined || reqd === false)) return;
      if (v === undefined || v === null) return;
      if (!evalSig(sig, v, thresh[sig.id])) fail.push({ ...sig, value: v, thresh: thresh[sig.id] });
    })
  );
  return { ok: fail.length === 0, fail };
}

export function fmt(sig, val) {
  if (val === null || val === undefined) return "WAIVED";
  if (sig.dir === "pass") return String(val).toUpperCase();
  if (sig.unit === "%") return (+val).toFixed(1) + "%";
  if (sig.unit === "s") return (+val).toFixed(1) + "s";
  if (sig.unit === "ms") return Math.round(val) + "ms";
  if (sig.unit === "fps") return Math.round(val) + "fps";
  return String(val);
}

export function applyAISuggestionsToThresh(thresh) {
  const next = { ...thresh };
  const suggestions = {
    crashrate: 0.08,
    anrrate: 0.03,
    errorrate: 0.6,
    oomrate: 0.1,
    startup: 2.2,
    screenload: 1.0,
    fps: 60,
    jserrors: 0.3,
    p95latency: 200,
    p99latency: 420,
    errorunderload: 0.5,
    recovery: 20,
    accuracy: 87,
    safety: 92,
    tone: 86,
    hallucination: 92,
    relevance: 84,
    accuracy_delta: 4,
    safety_delta: 3,
    tone_delta: 5,
    hallucination_delta: 4,
    relevance_delta: 4
  };
  Object.entries(suggestions).forEach(([k, v]) => {
    if (next[k] !== undefined) next[k] = v;
  });
  return next;
}

export const REG_LABELS = { req: "Regression required", wav: "Regression waivable", dis: "Role discretion" };
export const REG_CLASS = { req: "reg-req", wav: "reg-wav", dis: "reg-dis" };

export const TRIGGER_LABELS = {
  manual: "Manual declaration",
  env: "Environment promotion",
  label: "GitHub label",
  webhook: "Pipeline webhook"
};
