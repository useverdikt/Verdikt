/**
 * Release brief API helpers — same payload as MCP `release_brief`.
 */

import { apiGet } from "./apiClient.js";

/**
 * @param {string} releaseId
 * @param {{ mode?: "strict" | "default", navigate?: Function }} [options]
 */
export async function fetchReleaseBrief(releaseId, options = {}) {
  const { mode, navigate } = options;
  if (!releaseId) throw new Error("releaseId is required");
  const qs = mode === "strict" || mode === "default" ? `?mode=${mode}` : "";
  return apiGet(`/api/releases/${releaseId}/release-brief${qs}`, { navigate });
}

/** Visual tone for gate_action / suggested_verb chips. */
export function gateActionTone(action) {
  switch (String(action || "")) {
    case "merge":
      return "ok";
    case "collecting":
      return "info";
    case "self_heal":
    case "recover_certification":
      return "warn";
    case "escalate":
      return "bad";
    default:
      return "neutral";
  }
}

/**
 * Flatten top blockers into short display lines.
 * @param {Array<{ message?: string, signal_id?: string, type?: string, next_step?: string }>|null|undefined} blockers
 * @param {number} [limit]
 */
export function briefBlockerLines(blockers, limit = 3) {
  if (!Array.isArray(blockers)) return [];
  return blockers.slice(0, limit).map((b) => {
    const head = b.signal_id ? `${b.signal_id}: ` : b.type ? `${b.type}: ` : "";
    const msg = String(b.message || "").trim() || "Blocking condition";
    return { line: `${head}${msg}`, nextStep: b.next_step ? String(b.next_step) : null };
  });
}
