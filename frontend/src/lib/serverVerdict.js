import { isCertifiedLike, normalizeReleaseStatus, UI_RELEASE_STATUS } from "./releaseStatus.js";
import { resolveSignalMeta } from "./workspaceSignalUi.js";

/**
 * Live certification decisions come from the API (release.status + persisted
 * failed_signals). The browser must not recompute SHIP/BLOCK for those surfaces.
 */

function asSignalId(entry) {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") return entry.signal_id || entry.sigId || null;
  return null;
}

function verdictBlob(release) {
  return release?.intelligence?.verdict && typeof release.intelligence.verdict === "object"
    ? release.intelligence.verdict
    : {};
}

function lastEvalBlob(release) {
  return release?.last_signal_evaluation && typeof release.last_signal_evaluation === "object"
    ? release.last_signal_evaluation
    : {};
}

/** Raw failed-signal records from intelligence or the last ingest audit. */
export function serverFailedSignalRecords(release) {
  const verdict = verdictBlob(release);
  if (Array.isArray(verdict.failed_signals)) return verdict.failed_signals;
  if (Array.isArray(verdict.threshold_failed_signals)) return verdict.threshold_failed_signals;
  const last = lastEvalBlob(release);
  if (Array.isArray(last.failed_signals)) return last.failed_signals;
  if (Array.isArray(last.threshold_failed_signals)) return last.threshold_failed_signals;
  return null;
}

/** True when the payload includes a server failed-signal list (including empty). */
export function hasServerFailedSignalList(release) {
  return Array.isArray(serverFailedSignalRecords(release));
}

export function serverFailedSignalIds(release) {
  const records = serverFailedSignalRecords(release);
  if (!records) return new Set();
  return new Set(records.map(asSignalId).filter(Boolean));
}

/** SHIP / BLOCK / COLLECTING from stored status — never from live threshold math. */
export function displayRecommendationFromStatus(status) {
  const s = normalizeReleaseStatus(status);
  if (isCertifiedLike(s)) return "SHIP";
  if (s === UI_RELEASE_STATUS.UNCERTIFIED) return "BLOCK";
  return "COLLECTING";
}

function parseThresholdFromRule(rule) {
  if (rule == null) return undefined;
  const m = String(rule).match(/[<>]=?\s*([-+]?\d+(?:\.\d+)?)/);
  if (!m) return undefined;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : undefined;
}

function directionFromRule(rule, fallback) {
  const s = String(rule || "");
  if (s.includes("<=")) return "below";
  if (s.includes(">=")) return "above";
  return fallback || "above";
}

/**
 * Failing rows for override / cert / share UI.
 * Prefers persisted server records. Demo/offline callers may pass demoFallback.
 */
export function failingSignalsForDisplay(release, {
  definitions = [],
  findMeta,
  thresholds = {},
  demoFallback
} = {}) {
  const records = serverFailedSignalRecords(release);
  if (Array.isArray(records)) {
    return records
      .map((rec) => {
        const sigId = asSignalId(rec);
        if (!sigId) return null;
        const meta = resolveSignalMeta(sigId, definitions, findMeta) || {
          id: sigId,
          label: String(sigId).replace(/_/g, " "),
          direction: "above",
          unit: ""
        };
        const value = rec && typeof rec === "object" && rec.value !== undefined
          ? rec.value
          : release?.signals?.[sigId];
        const rule = rec && typeof rec === "object" ? rec.rule : undefined;
        const threshold = parseThresholdFromRule(rule) ?? thresholds[sigId];
        return {
          catLabel: meta.catLabel || "Signal",
          sigLabel: meta.label || sigId,
          sigId,
          value,
          threshold,
          direction: directionFromRule(rule, meta.direction),
          unit: meta.unit || "",
          isHardGate: Boolean(meta.hardGate),
          isDeltaFail: rec && typeof rec === "object"
            ? rec.failure_kind === "regression" || String(rule || "").startsWith("regression:")
            : false
        };
      })
      .filter(Boolean);
  }
  if (release?.backendReleaseId) return [];
  if (typeof demoFallback === "function") return demoFallback();
  return [];
}

export function isHardBlockFromRelease(release) {
  const verdict = verdictBlob(release);
  if (String(verdict.risk_level || "").toUpperCase() === "HIGH") return true;
  const records = serverFailedSignalRecords(release) || [];
  return records.some((rec) => {
    if (!rec || typeof rec !== "object") return false;
    const kind = String(rec.failure_kind || "");
    return kind === "missing_required" || kind === "hard_gate";
  });
}

export function categoryStatusFromFailedIds(cat, release) {
  const failed = serverFailedSignalIds(release);
  const results = (cat?.signals || []).map((sig) => {
    const val = release?.signals?.[sig.id];
    if (sig.conditional && (val === null || val === undefined)) return "waived";
    if (val === undefined || val === null) return null;
    return failed.has(sig.id) ? false : true;
  }).filter((r) => r !== null);
  if (results.length === 0) return "missing";
  if (results.some((r) => r === false)) return "fail";
  if (results.some((r) => r === "waived")) return "waived";
  return "pass";
}
