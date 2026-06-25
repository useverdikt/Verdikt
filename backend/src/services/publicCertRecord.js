"use strict";

const { queryOne, queryAll } = require("../database");
const { normalizeWorkspaceSlug } = require("../lib/workspaceSlug");
const { getReleaseIntelligence } = require("./intelligenceBuilder");
const { buildGateContext } = require("./gateContext");
const { getCertSignaturePublic } = require("./certSigner");
const { getThresholdMap } = require("./workspaceConfig");
const { getLatestSignalMap } = require("./verdictEngine");
const { listWorkspaceDefinitions } = require("./signalDefinitions");

const VERDICT_STATUSES = new Set(["CERTIFIED", "CERTIFIED_WITH_OVERRIDE", "UNCERTIFIED"]);

const RELEASE_TYPE_LABELS = {
  prompt_update: "Prompt / UX Update",
  model_patch: "Model Patch",
  safety_patch: "Safety Patch",
  policy_change: "Policy Change",
  model_update: "Model Update",
  incident_hotfix: "Incident Hotfix"
};

const SOURCE_GROUP_LABELS = {
  ai_eval: "AI Eval",
  delivery: "Delivery Reliability",
  performance: "Performance",
  stability: "Stability",
  braintrust: "AI Eval",
  browserstack: "Delivery Reliability",
  sentry: "Stability",
  datadog: "Performance",
  custom: "Signals"
};

function humanizeSignalId(signalId) {
  return String(signalId || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function inferUnit(signalId) {
  const id = String(signalId || "");
  if (id.includes("accuracy") || id.includes("safety") || id.includes("tone") || id.endsWith("_pct")) return "%";
  if (id.includes("latency")) return "ms";
  if (id === "fps") return "fps";
  if (id === "startup" || id === "screenload" || id === "recovery") return "s";
  return "";
}

function formatSignalValue(signalId, value) {
  if (value == null || !Number.isFinite(Number(value))) return "—";
  const n = Number(value);
  const unit = inferUnit(signalId);
  if (unit === "%") return `${n}%`;
  if (unit === "ms") return `${Math.round(n)}ms`;
  if (unit === "fps") return `${Math.round(n)}fps`;
  if (unit === "s") return `${n}s`;
  if (n === 0 || n === 1) return n >= 1 ? "PASS" : "FAIL";
  return String(n);
}

function formatThresholdLabel(threshold, direction) {
  if (!threshold) return "—";
  const unit = "";
  if (threshold.min != null) return `≥${threshold.min}${unit}`;
  if (threshold.max != null) return `≤${threshold.max}${unit}`;
  if (direction === "max") return "≤ threshold";
  return "≥ threshold";
}

function evaluateSignalStatus(value, threshold) {
  if (value == null || !Number.isFinite(Number(value))) return "unknown";
  const n = Number(value);
  if (threshold?.min != null && n < threshold.min) return "fail";
  if (threshold?.max != null && n > threshold.max) return "fail";
  if (threshold?.min != null || threshold?.max != null) return "pass";
  return "unknown";
}

function groupLabelForSource(sourceId) {
  const key = String(sourceId || "custom").toLowerCase();
  return SOURCE_GROUP_LABELS[key] || humanizeSignalId(key);
}

function formatVerdictTimestamp(iso) {
  if (!iso) return { date: "—", time: "" };
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { date: String(iso).slice(0, 10), time: "" };
  return {
    date: d.toISOString().slice(0, 10),
    time: `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} UTC`
  };
}

async function resolveWorkspaceByPublicSlug(slugParam) {
  const slug = normalizeWorkspaceSlug(slugParam);
  if (!slug) return null;
  const policy = await queryOne(
    `SELECT * FROM workspace_policies
     WHERE LOWER(public_slug) = LOWER(?) AND public_slug IS NOT NULL AND public_slug <> ''`,
    [slug]
  );
  if (!policy) return null;
  return { policy, slug: policy.public_slug || slug };
}

async function resolveReleaseByVersion(workspaceId, versionParam) {
  const version = decodeURIComponent(String(versionParam || "")).trim();
  if (!version) return null;
  return queryOne(
    `SELECT * FROM releases
     WHERE workspace_id = ? AND version = ?
     ORDER BY verdict_issued_at DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    [workspaceId, version]
  );
}

function mapOverrideRow(override, showJustification) {
  if (!override) return null;
  return {
    owner: override.approver_name || "Authorized approver",
    title: override.approver_role || null,
    recorded_at: override.created_at || null,
    justification: showJustification ? override.justification || null : null
  };
}

async function buildSignalGroups(workspaceId, releaseId, thresholdMap, latest, definitions) {
  const defById = new Map((definitions || []).map((d) => [d.signal_id, d]));
  const signalIds = new Set([
    ...Object.keys(latest || {}),
    ...Object.keys(thresholdMap || {}),
    ...(definitions || []).map((d) => d.signal_id)
  ]);

  const groups = new Map();

  for (const signalId of signalIds) {
    const def = defById.get(signalId);
    const threshold = thresholdMap[signalId];
    if (!def && latest[signalId] == null && !threshold) continue;

    const sourceKey = def?.source_id || "custom";
    const groupKey = String(sourceKey).toLowerCase();
    if (!groups.has(groupKey)) {
      groups.set(groupKey, { id: groupKey, label: groupLabelForSource(groupKey), signals: [] });
    }

    const value = latest[signalId];
    const status = evaluateSignalStatus(value, threshold);
    const direction = def?.direction || (threshold?.max != null ? "max" : "min");

    groups.get(groupKey).signals.push({
      signal_id: signalId,
      name: def?.display_name || humanizeSignalId(signalId),
      status,
      value: formatSignalValue(signalId, value),
      raw_value: value ?? null,
      threshold: formatThresholdLabel(threshold, direction),
      required: !!(threshold?.required_for_certification),
      hard_gate: !!(threshold?.required_for_certification && threshold?.min != null)
    });
  }

  for (const g of groups.values()) {
    g.signals.sort((a, b) => {
      if (a.required && !b.required) return -1;
      if (!a.required && b.required) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  return [...groups.values()].filter((g) => g.signals.length > 0);
}

function buildFailingList(intelligence, remediation, thresholdMap, latest, definitions) {
  const defById = new Map((definitions || []).map((d) => [d.signal_id, d]));
  const failures = remediation?.failures || intelligence?.verdict?.failed_signals || [];

  return failures
    .filter((f) => f?.signal_id && f.signal_id !== "release")
    .map((f) => {
      const signalId = f.signal_id;
      const def = defById.get(signalId);
      const threshold = thresholdMap[signalId] || f.threshold || {};
      const direction = def?.direction || (threshold?.max != null ? "max" : "min");
      const value = f.value ?? latest[signalId];
      return {
        category: groupLabelForSource(def?.source_id || "custom"),
        signal_id: signalId,
        name: def?.display_name || humanizeSignalId(signalId),
        value: formatSignalValue(signalId, value),
        threshold: formatThresholdLabel(threshold, direction),
        hard_gate: !!(threshold?.required_for_certification)
      };
    });
}

/**
 * Public certification record for /cert/:slug/:version (no auth).
 * Returns null when not found or not public; throws 404-shaped errors via caller.
 */
async function getPublicCertRecord(slugParam, versionParam) {
  const resolved = await resolveWorkspaceByPublicSlug(slugParam);
  if (!resolved) return { error: "not_found", status: 404 };

  const { policy, slug } = resolved;
  const publicEnabled = policy.public_cert_records !== false && policy.public_cert_records !== 0;
  if (!publicEnabled) return { error: "not_found", status: 404 };

  const release = await resolveReleaseByVersion(policy.workspace_id, versionParam);
  if (!release) return { error: "not_found", status: 404 };

  const status = String(release.status || "").toUpperCase();
  if (!VERDICT_STATUSES.has(status) || !release.verdict_issued_at) {
    return { error: "not_found", status: 404 };
  }

  const showSignalDetail = policy.show_signal_detail !== false && policy.show_signal_detail !== 0;
  const showOverrideJust = policy.show_override_justification !== false && policy.show_override_justification !== 0;

  const [intelligence, override, signature, thresholdMap, latest, definitions] = await Promise.all([
    getReleaseIntelligence(release.id),
    queryOne("SELECT * FROM overrides WHERE release_id = ?", [release.id]),
    getCertSignaturePublic(release.id),
    getThresholdMap(release.workspace_id),
    getLatestSignalMap(release.id),
    listWorkspaceDefinitions(release.workspace_id)
  ]);

  const { certification, remediation, snapshot } = await buildGateContext(release, intelligence);
  const { date, time } = formatVerdictTimestamp(release.verdict_issued_at);

  const displayName =
    (policy.public_display_name && String(policy.public_display_name).trim()) ||
    slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const payload = {
    workspace: {
      slug,
      display_name: displayName
    },
    release: {
      id: release.id,
      version: release.version,
      status,
      release_type: release.release_type,
      release_type_label: RELEASE_TYPE_LABELS[release.release_type] || humanizeSignalId(release.release_type),
      environment: release.environment || null,
      verdict_issued_at: release.verdict_issued_at,
      date,
      time
    },
    certification:
      certification && (status === "CERTIFIED" || status === "CERTIFIED_WITH_OVERRIDE")
        ? {
            summary: certification.summary,
            confidence: certification.confidence,
            risk_level: certification.risk_level,
            required_signals_met: certification.required_signals_met || [],
            baseline_reference: certification.baseline_reference || null,
            monitoring_note: certification.monitoring_note || null,
            note: certification.note || null
          }
        : null,
    failing: status === "UNCERTIFIED" ? buildFailingList(intelligence, remediation, thresholdMap, latest, definitions) : [],
    override: status === "CERTIFIED_WITH_OVERRIDE" ? mapOverrideRow(override, showOverrideJust) : null,
    signature: signature
      ? {
          algorithm: signature.algorithm,
          payload_hash: signature.payload_hash,
          signed_at: signature.signed_at,
          public_key_hint: signature.public_key_hint,
          evidence_hash: signature.evidence_hash || snapshot?.evidence_hash || null
        }
      : null,
    frozen_at: snapshot?.frozen_at || null,
    evidence_hash: snapshot?.evidence_hash || null,
    signal_groups: showSignalDetail ? await buildSignalGroups(release.workspace_id, release.id, thresholdMap, latest, definitions) : null
  };

  return { record: payload };
}

module.exports = { getPublicCertRecord, normalizeWorkspaceSlug };
