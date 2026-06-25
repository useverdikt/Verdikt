"use strict";

/**
 * Classify signal ingest provenance and compute release-level evidence quality.
 */

const { queryAll, run } = require("../database");
const { nowIso } = require("../lib/time");

/** @typedef {"integration"|"programmatic"|"manual"|"simulator"|"unknown"} EvidenceTier */

const TIER_LABELS = {
  integration: "integration pull",
  programmatic: "programmatic ingest",
  manual: "manual entry",
  simulator: "Signal Simulator",
  unknown: "unknown source"
};

/**
 * @param {string|null|undefined} source
 * @returns {EvidenceTier}
 */
function classifySignalSource(source) {
  const s = String(source || "")
    .trim()
    .toLowerCase();
  if (!s) return "manual";
  if (s.startsWith("pulled:")) return "integration";
  if (s.startsWith("simulator:")) return "simulator";
  if (s === "agent" || s.startsWith("ci") || s.includes("webhook") || s.startsWith("csv:")) return "programmatic";
  if (s === "manual") return "manual";
  return "unknown";
}

/**
 * Latest value + source per signal_id (ascending id — last wins).
 * @param {Array<{ signal_id: string, value: number, source?: string|null, created_at?: string }>} rows
 */
function latestSignalRowsById(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const id = String(row.signal_id || "").trim();
    if (!id) continue;
    const prev = map.get(id);
    if (!prev) {
      map.set(id, {
        signal_id: id,
        value: row.value,
        source: row.source ?? null,
        created_at: row.created_at ?? null
      });
      continue;
    }
    const rowId = Number(row.id);
    const prevId = Number(prev.id);
    if (Number.isFinite(rowId) && Number.isFinite(prevId)) {
      if (rowId > prevId) {
        map.set(id, {
          signal_id: id,
          value: row.value,
          source: row.source ?? null,
          created_at: row.created_at ?? null
        });
      }
    } else {
      map.set(id, {
        signal_id: id,
        value: row.value,
        source: row.source ?? null,
        created_at: row.created_at ?? null
      });
    }
  }
  return [...map.values()];
}

/**
 * @param {Array<{ signal_id: string, source?: string|null }>} signalRows
 */
function summarizeEvidence(signalRows) {
  const latest = latestSignalRowsById(signalRows);
  const by_tier = { integration: 0, programmatic: 0, manual: 0, simulator: 0, unknown: 0 };
  const signals = latest.map((row) => {
    const tier = classifySignalSource(row.source);
    by_tier[tier] += 1;
    return { signal_id: row.signal_id, source: row.source, tier };
  });

  const total = signals.length;
  const parts = [];
  if (by_tier.integration) parts.push(`${by_tier.integration}/${total} signals from ${TIER_LABELS.integration}`);
  if (by_tier.programmatic) parts.push(`${by_tier.programmatic}/${total} signals from ${TIER_LABELS.programmatic}`);
  if (by_tier.simulator) parts.push(`${by_tier.simulator}/${total} signals from ${TIER_LABELS.simulator}`);
  if (by_tier.manual) parts.push(`${by_tier.manual}/${total} signals from ${TIER_LABELS.manual}`);
  if (by_tier.unknown) parts.push(`${by_tier.unknown}/${total} signals from ${TIER_LABELS.unknown}`);

  const line =
    total === 0
      ? "No signals recorded"
      : parts.length
        ? `Evidence quality: ${parts.join(" · ")}`
        : "Evidence quality: unknown";

  return { total, by_tier, line, signals };
}

/**
 * @param {{ by_tier: Record<EvidenceTier, number>, total: number }} summary
 * @returns {"INTEGRATION_BACKED"|"SIMULATOR_BACKED"|"PROGRAMMATIC_BACKED"|"MANUAL_BACKED"|"MIXED"|"UNKNOWN"|null}
 */
function deriveEvidenceQualityFlag(summary) {
  const { total, by_tier } = summary;
  if (!total) return null;

  const active = Object.entries(by_tier).filter(([, n]) => n > 0);
  if (active.length === 0) return "UNKNOWN";
  if (active.length === 1) {
    const [tier] = active[0];
    if (tier === "integration") return "INTEGRATION_BACKED";
    if (tier === "simulator") return "SIMULATOR_BACKED";
    if (tier === "programmatic") return "PROGRAMMATIC_BACKED";
    if (tier === "manual") return "MANUAL_BACKED";
    return "UNKNOWN";
  }
  return "MIXED";
}

async function loadSignalRowsForRelease(releaseId) {
  return queryAll(
    "SELECT id, signal_id, value, source, created_at FROM signals WHERE release_id = $1 ORDER BY id ASC",
    [releaseId]
  );
}

/**
 * Compute and persist evidence quality on a release after verdict (or lazy backfill).
 * @param {string} releaseId
 * @returns {Promise<{ evidence_quality: string|null, evidence_summary: object }>}
 */
async function persistReleaseEvidenceQuality(releaseId) {
  const rows = await loadSignalRowsForRelease(releaseId);
  const evidence_summary = summarizeEvidence(rows);
  const evidence_quality = deriveEvidenceQualityFlag(evidence_summary);

  await run("UPDATE releases SET evidence_quality = $1, evidence_summary_json = $2, updated_at = $3 WHERE id = $4", [
    evidence_quality,
    JSON.stringify(evidence_summary),
    nowIso(),
    releaseId
  ]);

  return { evidence_quality, evidence_summary };
}

/**
 * Parse stored summary or compute from rows.
 * @param {object|null} releaseRow
 * @param {Array<object>|null} [signalRows]
 */
function resolveEvidenceForRelease(releaseRow, signalRows = null) {
  let evidence_summary = null;
  if (releaseRow?.evidence_summary_json) {
    try {
      evidence_summary = JSON.parse(releaseRow.evidence_summary_json);
    } catch {
      evidence_summary = null;
    }
  }
  if (!evidence_summary && signalRows?.length) {
    evidence_summary = summarizeEvidence(signalRows);
  }
  const evidence_quality =
    releaseRow?.evidence_quality ?? (evidence_summary ? deriveEvidenceQualityFlag(evidence_summary) : null);
  return { evidence_quality, evidence_summary };
}

module.exports = {
  classifySignalSource,
  latestSignalRowsById,
  summarizeEvidence,
  deriveEvidenceQualityFlag,
  persistReleaseEvidenceQuality,
  resolveEvidenceForRelease,
  TIER_LABELS
};
