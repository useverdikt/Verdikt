/**
 * Normalises workspace project env fields from localStorage / session.
 * Pre-prod tiers (staging, uat) inform certification gates; production observation is a separate flag.
 */

const TIER_ORDER = ["staging", "uat"];

/** Prefer staging when both tiers apply — staging is typically the last production-like stop before release. */
export function primaryCertEnvFromTiers(certEnvs) {
  const set = new Set((certEnvs || []).map((e) => String(e).toLowerCase()));
  if (set.has("staging")) return "staging";
  if (set.has("uat")) return "uat";
  return "uat";
}

/**
 * @param {Record<string, unknown> | null | undefined} p
 * @returns {{ certEnvs: string[]; env: string; prodObservation: boolean }}
 */
export function normalizeStoredProject(p) {
  const raw = p && typeof p === "object" ? p : {};
  let certEnvs = [];
  if (Array.isArray(raw.certEnvs) && raw.certEnvs.length) {
    certEnvs = raw.certEnvs
      .map((x) => String(x).toLowerCase())
      .filter((e) => e === "staging" || e === "uat");
  }
  if (!certEnvs.length) {
    const e = String(raw.env || "uat").toLowerCase();
    if (e === "staging" || e === "uat") certEnvs = [e];
    else if (e === "prod" || e === "production") certEnvs = ["uat"];
    else certEnvs = ["uat"];
  }
  certEnvs = TIER_ORDER.filter((t) => certEnvs.includes(t));
  const primary = primaryCertEnvFromTiers(certEnvs);
  /** Strict opt-in: production intelligence and post-deploy gathering run only when explicitly enabled. */
  const prodObservation = raw.prodObservation === true;
  return {
    certEnvs,
    env: primary.toUpperCase(),
    prodObservation
  };
}

/** Short label for sidebar when multiple pre-prod tiers are selected, e.g. STG+UAT */
export function formatCertTiersShort(certEnvs) {
  if (!Array.isArray(certEnvs) || certEnvs.length === 0) return "";
  const ordered = TIER_ORDER.filter((t) => certEnvs.includes(t));
  return ordered.map((c) => (c === "staging" ? "STG" : "UAT")).join("+");
}
