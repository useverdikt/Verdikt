"use strict";

const INCIDENT_LABEL_PATTERN = /\b(incident|p0|p1|sev-?1|sev-?2|outage|hotfix)\b/;
const INCIDENT_TITLE_PATTERN = /\b(incident|p0|p1|sev-?1|sev-?2|outage)\b/;

/**
 * Classify GitHub PR payload into a Verdikt release type.
 * incident_hotfix requires incident labels or explicit incident severity in the title —
 * bare "revert"/"rollback" in titles alone do not qualify.
 */
function classifyGithubReleaseType(payload, fallback = "model_update") {
  const title = String(payload?.pull_request?.title || "").toLowerCase();
  const labels = [
    ...new Set(
      (payload?.pull_request?.labels || [])
        .map((l) => String(l?.name || "").toLowerCase().trim())
        .filter(Boolean)
    )
  ];
  const haystack = `${title} ${labels.join(" ")}`;

  if (/\b(prompt|ux|ui|copy)\b/.test(haystack)) return "prompt_update";
  if (/\b(safety|guardrail|security)\b/.test(haystack)) return "safety_patch";
  if (/\b(routing|policy)\b/.test(haystack)) return "policy_change";

  const hasIncidentLabel = labels.some((l) => INCIDENT_LABEL_PATTERN.test(l));
  if (hasIncidentLabel || INCIDENT_TITLE_PATTERN.test(title)) return "incident_hotfix";

  if (/\b(model\s*patch)\b/.test(haystack)) return "model_patch";
  if (/\b(model|weights|checkpoint|llm|gpt|claude|gemini)\b/.test(haystack)) return "model_update";
  return fallback;
}

module.exports = { classifyGithubReleaseType, INCIDENT_LABEL_PATTERN, INCIDENT_TITLE_PATTERN };
