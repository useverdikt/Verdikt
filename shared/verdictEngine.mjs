/**
 * Frozen-evidence verdict math. Must stay in sync with verdictEngine.cjs.
 */

import crypto from "node:crypto";

export const ENGINE_VERSION = "2026.08.1";
export const CERT_BUNDLE_SCHEMA = "verdikt.cert.v1";

export function sortDeep(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.keys(value)
    .sort()
    .reduce((acc, key) => {
      acc[key] = sortDeep(value[key]);
      return acc;
    }, {});
}

export function stableJson(value) {
  return JSON.stringify(sortDeep(value));
}

export function computeEvidenceHash(thresholdMap = {}, signalMap = {}) {
  return crypto
    .createHash("sha256")
    .update(stableJson({ thresholds: thresholdMap || {}, signals: signalMap || {} }))
    .digest("hex");
}

export function evaluateFrozenEvidence(signalMap, thresholdMap) {
  const signals = signalMap && typeof signalMap === "object" ? signalMap : {};
  const thresholds = thresholdMap && typeof thresholdMap === "object" ? thresholdMap : {};
  const failed_signals = [];
  for (const [signalId, threshold] of Object.entries(thresholds)) {
    if (!threshold || typeof threshold !== "object") continue;
    if (String(signalId).endsWith("_delta")) continue;
    if (!threshold.required_for_certification) continue;
    if (signals[signalId] == null) continue;
    const value = signals[signalId];
    if (threshold.min != null && value < threshold.min) {
      failed_signals.push({
        signal_id: signalId,
        value,
        failure_kind: "absolute_threshold",
        rule: `>= ${threshold.min}`
      });
    }
    if (threshold.max != null && value > threshold.max) {
      failed_signals.push({
        signal_id: signalId,
        value,
        failure_kind: "absolute_threshold",
        rule: `<= ${threshold.max}`
      });
    }
  }
  return {
    engine_status: failed_signals.length === 0 ? "CERTIFIED" : "UNCERTIFIED",
    failed_signals
  };
}

export function recordedStatusAgrees(recordedStatus, engineStatus) {
  const rec = String(recordedStatus || "").toUpperCase();
  const eng = String(engineStatus || "").toUpperCase();
  if (rec === "CERTIFIED") return eng === "CERTIFIED";
  if (rec === "UNCERTIFIED") return eng === "UNCERTIFIED";
  if (rec === "CERTIFIED_WITH_OVERRIDE") return eng === "UNCERTIFIED";
  if (rec === "CERTIFICATION_REVOKED") return eng === "CERTIFIED" || eng === "UNCERTIFIED";
  return false;
}
