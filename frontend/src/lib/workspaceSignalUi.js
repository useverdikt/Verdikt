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

/** Flat signal lines for certification record / share (definitions-first labels). */
export function buildCertRecordSignalEntries({
  definitions = [],
  legacyOrdered = [],
  releaseSignals = {},
  thresholds = {},
  evaluateSignal,
  fmtVal,
  getRegressionRequired,
  releaseType
}) {
  const rows = buildDetailSignalRows(definitions, legacyOrdered, releaseSignals);
  const reqd = getRegressionRequired?.(releaseType);
  const out = [];

  for (const { sig } of rows) {
    const val = releaseSignals[sig.id];
    const isWaived = sig.conditional && (val === null || val === undefined || reqd === false);
    if (isWaived) {
      out.push({
        id: sig.id,
        label: sig.label,
        display: "WAIVED",
        pass: true,
        waived: true,
        rawValue: val,
        threshold: thresholds[sig.id],
        direction: sig.direction,
        unit: sig.unit
      });
      continue;
    }
    if (val === undefined || val === null) continue;

    const { pass } = evaluateSignal(sig, val, thresholds[sig.id]);
    out.push({
      id: sig.id,
      label: sig.label,
      display: fmtVal(sig, val),
      pass,
      waived: false,
      rawValue: val,
      threshold: thresholds[sig.id],
      direction: sig.direction,
      unit: sig.unit
    });
  }

  return out;
}

/** Failing signals for cert UI — uses workspace definition labels when present. */
export function buildCertRecordFailing({
  definitions = [],
  legacyOrdered = [],
  releaseSignals = {},
  thresholds = {},
  evaluateSignal,
  fmtVal,
  getRegressionRequired,
  releaseType
}) {
  return buildCertRecordSignalEntries({
    definitions,
    legacyOrdered,
    releaseSignals,
    thresholds,
    evaluateSignal,
    fmtVal,
    getRegressionRequired,
    releaseType
  })
    .filter((e) => !e.pass && !e.waived)
    .map((e) => ({
      catLabel: "Signal",
      sigLabel: e.label,
      sigId: e.id,
      value: e.rawValue,
      threshold: e.threshold,
      direction: e.direction,
      unit: e.unit
    }));
}

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

/** Source dropdown options for custom signal creation (all integrations + push partners). */
export function buildCustomSignalSourceOptions(connectors = [], catalog = []) {
  const byId = new Map();
  const nameFor = (id) => {
    const hit = catalog.find((s) => s.id === id);
    if (hit?.name) return hit.name;
    return String(id || "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  };

  byId.set("custom", { id: "custom", label: "Custom (API push)" });

  for (const c of connectors) {
    const id = c?.source_id;
    if (!id || id === "*" || byId.has(id)) continue;
    const mode = c.ingest_mode === "push" ? "API push" : "integration pull";
    byId.set(id, { id, label: `${nameFor(id)} (${mode})` });
  }

  for (const src of catalog) {
    if (!src?.id || byId.has(src.id)) continue;
    byId.set(src.id, { id: src.id, label: `${src.name} (integration pull)` });
  }

  return [...byId.values()].sort((a, b) => {
    if (a.id === "custom") return -1;
    if (b.id === "custom") return 1;
    return a.label.localeCompare(b.label);
  });
}
