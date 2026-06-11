import { C } from "../theme/tokens.js";

/** @typedef {"integration"|"programmatic"|"manual"|"simulator"|"unknown"} ProvenanceTier */

/** @type {Record<ProvenanceTier, { label: string; shortLabel: string; color: string; description: string }>} */
export const PROVENANCE_TIER_META = {
  integration: {
    label: "Integration pull",
    shortLabel: "Pull",
    color: C.green,
    description: "Auto-pulled from a connected integration tagged to this commit"
  },
  programmatic: {
    label: "Programmatic",
    shortLabel: "CI / Agent",
    color: "#38bdf8",
    description: "Posted by CI pipeline or agent via API"
  },
  manual: {
    label: "Manual entry",
    shortLabel: "Manual",
    color: C.amber,
    description: "Entered manually via API or UI"
  },
  simulator: {
    label: "Signal Simulator",
    shortLabel: "Demo",
    color: "#f97316",
    description: "Demo / dogfood values from Signal Simulator — not integration evidence"
  },
  unknown: {
    label: "Unknown source",
    shortLabel: "Unknown",
    color: C.dim,
    description: "Source not classified"
  }
};

/** @type {Record<string, { label: string; color: string; description: string }>} */
export const EVIDENCE_QUALITY_META = {
  INTEGRATION_BACKED: {
    label: "Integration-backed",
    color: C.green,
    description: "All signals came from integration auto-pull"
  },
  SIMULATOR_BACKED: {
    label: "Simulator (demo)",
    color: "#f97316",
    description: "All signals came from Signal Simulator — not production integration evidence"
  },
  PROGRAMMATIC_BACKED: {
    label: "Programmatic",
    color: "#38bdf8",
    description: "All signals posted by CI or agent"
  },
  MANUAL_BACKED: {
    label: "Manual entry",
    color: C.amber,
    description: "All signals entered manually"
  },
  MIXED: {
    label: "Mixed evidence",
    color: C.amber,
    description: "Signals from more than one provenance tier"
  },
  UNKNOWN: {
    label: "Unknown",
    color: C.dim,
    description: "Evidence provenance could not be classified"
  }
};

/**
 * @param {string|null|undefined} source
 * @returns {ProvenanceTier}
 */
export function classifySignalSource(source) {
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
 * Build map signal_id → latest row (rows should include id; first wins if DESC sorted).
 * @param {Array<{ signal_id: string, source?: string, id?: number }>} rows
 */
export function latestSignalRowMap(rows) {
  /** @type {Record<string, object>} */
  const map = {};
  for (const row of rows || []) {
    const id = row.signal_id;
    if (!id) continue;
    const prev = map[id];
    if (!prev) {
      map[id] = row;
      continue;
    }
    const rowId = Number(row.id);
    const prevId = Number(prev.id);
    if (Number.isFinite(rowId) && Number.isFinite(prevId) && rowId > prevId) {
      map[id] = row;
    }
  }
  return map;
}

/** @param {string|null|undefined} source */
export function formatSourceLabel(source) {
  const s = String(source || "").trim();
  if (!s) return "manual";
  if (s.startsWith("pulled:")) return s.replace("pulled:", "") + " pull";
  if (s.startsWith("simulator:")) return "simulator:" + s.replace("simulator:", "");
  return s;
}

/** @param {object|null|undefined} release */
export function getEvidenceSummaryLine(release) {
  if (release?.evidence_summary?.line) return release.evidence_summary.line;
  if (!release?.signalRows?.length) return null;
  const tiers = { integration: 0, programmatic: 0, manual: 0, simulator: 0, unknown: 0 };
  const map = latestSignalRowMap(release.signalRows);
  for (const row of Object.values(map)) {
    tiers[classifySignalSource(row.source)] += 1;
  }
  const total = Object.values(map).length;
  if (!total) return null;
  const parts = [];
  if (tiers.integration) parts.push(`${tiers.integration}/${total} signals from integration pull`);
  if (tiers.programmatic) parts.push(`${tiers.programmatic}/${total} signals from programmatic ingest`);
  if (tiers.simulator) parts.push(`${tiers.simulator}/${total} signals from Signal Simulator`);
  if (tiers.manual) parts.push(`${tiers.manual}/${total} signals from manual entry`);
  if (tiers.unknown) parts.push(`${tiers.unknown}/${total} signals from unknown source`);
  return parts.length ? `Evidence quality: ${parts.join(" · ")}` : null;
}

/** @param {string|null|undefined} flag */
export function evidenceQualityMeta(flag) {
  if (!flag) return null;
  return EVIDENCE_QUALITY_META[flag] || EVIDENCE_QUALITY_META.UNKNOWN;
}

/** @param {ProvenanceTier} tier */
export function provenanceTierMeta(tier) {
  return PROVENANCE_TIER_META[tier] || PROVENANCE_TIER_META.unknown;
}
