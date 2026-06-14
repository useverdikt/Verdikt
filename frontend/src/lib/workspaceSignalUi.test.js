import { describe, expect, it } from "vitest";
import { buildDetailSignalRows, buildCertRecordFailing, buildCertRecordSignalEntries, definitionToSignalMeta, resolveSignalMeta } from "./workspaceSignalUi.js";

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
});
