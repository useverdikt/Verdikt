import { getSignalThresholdDirection, thresholdBoundsToScalar } from "./thresholdBounds.js";

/** Map workspace definition → UI signal meta for evaluateSignal / fmtVal. */
export function definitionToSignalMeta(def) {
  if (!def) return null;
  const direction = def.direction === "max" ? "below" : "above";
  return {
    id: def.signal_id,
    label: def.display_name || def.signal_id,
    direction,
    unit: def.unit || "",
    hardGate: false,
    conditional: false,
    custom: true
  };
}

/** Lookup: definitions first, then legacy SIGNAL_CATEGORIES finder. */
export function resolveSignalMeta(signalId, definitions = [], legacyFind) {
  const def = definitions.find((d) => d.signal_id === signalId);
  if (def) return definitionToSignalMeta(def);
  return legacyFind ? legacyFind(signalId) : null;
}

/** Build detail rows: workspace definitions first, then legacy ordered signals not duplicated. */
export function buildDetailSignalRows(definitions, legacyOrdered, releaseSignals = {}) {
  const seen = new Set();
  const rows = [];

  for (const def of definitions || []) {
    seen.add(def.signal_id);
    rows.push({
      sig: definitionToSignalMeta(def),
      fromDefinition: true
    });
  }

  for (const entry of legacyOrdered || []) {
    if (seen.has(entry.sig.id)) continue;
    if (releaseSignals[entry.sig.id] == null && !definitions?.length) {
      rows.push(entry);
      continue;
    }
    if (releaseSignals[entry.sig.id] != null) {
      rows.push(entry);
      seen.add(entry.sig.id);
    }
  }

  // Custom ingested signals not in definitions or legacy taxonomy
  for (const signalId of Object.keys(releaseSignals || {})) {
    if (seen.has(signalId)) continue;
    if (releaseSignals[signalId] == null) continue;
    rows.push({
      sig: {
        id: signalId,
        label: signalId.replace(/_/g, " "),
        direction: "below",
        unit: "",
        hardGate: false,
        conditional: false,
        custom: true
      },
      fromDefinition: false
    });
  }

  return rows;
}

/** Scalar threshold for UI from API threshold row + definition direction. */
export function scalarThresholdForDefinition(def, thresholdRow) {
  if (!thresholdRow) return undefined;
  return thresholdBoundsToScalar(def?.signal_id || "", thresholdRow);
}

export function formatDefinitionThresholdLine(def, thresholdRow) {
  const scalar = scalarThresholdForDefinition(def, thresholdRow);
  if (scalar == null) return null;
  const dir = def?.direction || getSignalThresholdDirection(def?.signal_id);
  if (dir === "max") return `≤ ${scalar}${def?.unit ? ` ${def.unit}` : ""}`;
  return `≥ ${scalar}${def?.unit ? ` ${def.unit}` : ""}`;
}

export function groupLibraryByCategory(library) {
  const groups = new Map();
  for (const entry of library || []) {
    const cat = entry.category || "other";
    if (!groups.has(cat)) groups.set(cat, []);
    groups.get(cat).push(entry);
  }
  return groups;
}

export const LIBRARY_CATEGORY_LABELS = {
  ai_quality: "AI quality",
  delivery: "Delivery reliability",
  performance: "Performance",
  reliability: "Reliability",
  manual_qa: "Manual QA",
  other: "Other"
};
