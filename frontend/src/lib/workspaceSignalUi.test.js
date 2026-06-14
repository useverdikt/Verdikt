import { describe, expect, it } from "vitest";
import { buildDetailSignalRows, definitionToSignalMeta, resolveSignalMeta } from "./workspaceSignalUi.js";

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
});
