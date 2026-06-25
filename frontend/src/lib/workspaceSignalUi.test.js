import { describe, expect, it } from "vitest";
import {
  buildCertRecordFailing,
  buildCertRecordSignalEntries,
  buildCustomSignalSourceGroups,
  buildCustomSignalSourceOptions,
  buildDetailSignalRows,
  definitionToSignalMeta,
  resolveSignalMeta
} from "./workspaceSignalUi.js";
import { SIGNAL_SOURCE_SECTIONS } from "./releaseSourceLanes.js";

describe("workspaceSignalUi", () => {
  it("maps definition to signal meta with below direction for max thresholds", () => {
    const meta = definitionToSignalMeta({
      signal_id: "behavioural_drift",
      display_name: "Behavioural Drift",
      direction: "max",
      unit: "score"
    });
    expect(meta.direction).toBe("below");
    expect(meta.label).toBe("Behavioural Drift");
  });

  it("resolves custom definition before legacy taxonomy", () => {
    const legacyFind = (id) => (id === "accuracy" ? { id: "accuracy", label: "Legacy Accuracy" } : null);
    const meta = resolveSignalMeta(
      "behavioural_drift",
      [{ signal_id: "behavioural_drift", display_name: "Drift", direction: "max" }],
      legacyFind
    );
    expect(meta.label).toBe("Drift");
  });

  it("includes ingested custom signals in detail rows", () => {
    const rows = buildDetailSignalRows(
      [{ signal_id: "behavioural_drift", display_name: "Drift", direction: "max" }],
      [],
      { behavioural_drift: 0.1, other_metric: 2 }
    );
    expect(rows.some((r) => r.sig.id === "behavioural_drift")).toBe(true);
    expect(rows.some((r) => r.sig.id === "other_metric")).toBe(true);
  });

  it("cert record uses display_name not raw signal_id", () => {
    const evaluateSignal = (sig, val, thr) => ({
      pass: sig.direction === "below" ? val <= thr : val >= thr
    });
    const fmtVal = (sig, val) => String(val);
    const entries = buildCertRecordSignalEntries({
      definitions: [
        {
          signal_id: "behavioural_drift",
          display_name: "Behavioural Drift",
          direction: "max",
          unit: "score"
        }
      ],
      legacyOrdered: [],
      releaseSignals: { behavioural_drift: 0.12 },
      thresholds: { behavioural_drift: 0.15 },
      evaluateSignal,
      fmtVal,
      getRegressionRequired: () => true,
      releaseType: "model_update"
    });
    expect(entries).toHaveLength(1);
    expect(entries[0].label).toBe("Behavioural Drift");
    expect(entries[0].label).not.toBe("behavioural_drift");
    expect(entries[0].pass).toBe(true);
  });

  it("cert record failing section uses human labels for custom signals", () => {
    const evaluateSignal = (sig, val, thr) => ({
      pass: sig.direction === "below" ? val <= thr : val >= thr
    });
    const fmtVal = (sig, val) => String(val);
    const failing = buildCertRecordFailing({
      definitions: [
        {
          signal_id: "behavioural_drift",
          display_name: "Behavioural Drift",
          direction: "max"
        }
      ],
      legacyOrdered: [],
      releaseSignals: { behavioural_drift: 0.2 },
      thresholds: { behavioural_drift: 0.15 },
      evaluateSignal,
      fmtVal,
      getRegressionRequired: () => true,
      releaseType: "model_update"
    });
    expect(failing).toHaveLength(1);
    expect(failing[0].sigLabel).toBe("Behavioural Drift");
  });

  it("lists pull and push sources for custom signal dropdown", () => {
    const catalog = [
      { id: "braintrust", name: "Braintrust" },
      { id: "langsmith", name: "LangSmith" }
    ];
    const connectors = [
      { source_id: "braintrust", ingest_mode: "pull" },
      { source_id: "manual_qa", ingest_mode: "push" }
    ];
    const groups = buildCustomSignalSourceGroups(connectors, catalog, SIGNAL_SOURCE_SECTIONS);
    const options = buildCustomSignalSourceOptions(connectors, catalog, SIGNAL_SOURCE_SECTIONS);
    const ids = options.map((o) => o.id);
    expect(ids).toContain("custom");
    expect(ids).toContain("braintrust");
    expect(ids).toContain("langsmith");
    expect(options.find((o) => o.id === "braintrust")?.label).toMatch(/integration pull/i);
    expect(options.find((o) => o.id === "custom")?.label).toMatch(/API push/i);
    expect(groups.find((g) => g.id === "ai_eval")?.options.some((o) => o.id === "braintrust")).toBe(true);
    expect(groups.find((g) => g.id === "partner")?.options.some((o) => o.id === "custom")).toBe(true);
  });
});
