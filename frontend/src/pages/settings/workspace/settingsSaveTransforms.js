/**
 * Pure transforms for Settings save paths — used by SettingsWorkspace and unit tests.
 */

/** Mirrors general-settings slug behaviour (workspace URL segment). */
export function slugifyWorkspaceSlug(v) {
  return String(v || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Returns http(s) origin or null (same rules as save general). */
export function normalizeApiBaseOrigin(input) {
  let v = String(input || "").trim();
  if (!v) return null;
  v = v.replace(/\/$/, "");
  try {
    const u = new URL(v);
    if (u.protocol === "http:" || u.protocol === "https:") return u.origin;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * @param {Record<string, string | number>} threshDefaults — THRESH_DEFAULTS
 * @param {Record<string, unknown>} thresholds — UI state (may be strings from inputs)
 * @returns {Record<string, string | number>} normalized row for localStorage + API derivation
 */
export function normalizeThresholdsStateForSave(threshDefaults, thresholds) {
  const t = {};
  Object.keys(threshDefaults).forEach((k) => {
    const def = threshDefaults[k];
    const raw = thresholds[k];
    if (typeof def === "string") t[k] = raw != null && raw !== "" ? String(raw) : def;
    else t[k] = parseFloat(raw) || def;
  });
  return t;
}

/**
 * API body.thresholds map: numeric thresholds only; latency uses max, others use min.
 * Matches SettingsWorkspace.saveThresholds.
 */
export function thresholdNormalizedToApiPayload(t) {
  const thresholdPayload = {};
  Object.entries(t).forEach(([signalId, value]) => {
    if (typeof value === "number") {
      const isLatency = signalId === "p95latency" || signalId === "p99latency";
      thresholdPayload[signalId] = isLatency ? { min: null, max: value } : { min: value, max: null };
    }
  });
  return thresholdPayload;
}
