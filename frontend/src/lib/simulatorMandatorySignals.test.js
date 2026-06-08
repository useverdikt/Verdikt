import { describe, expect, it } from "vitest";
import {
  buildSimulatorThresholdMap,
  filterSimulatorSourcesForMandatory,
  countSimulatorEligibleRequired,
  getSimulatorEmptyHint
} from "./simulatorMandatorySignals.js";

const SOURCES = [
  {
    id: "braintrust",
    signals: [{ id: "accuracy" }, { id: "safety" }]
  },
  {
    id: "browserstack",
    signals: [{ id: "smoke" }, { id: "e2e_regression" }]
  }
];

describe("simulatorMandatorySignals", () => {
  it("shows required signals without requiring connected integrations", () => {
    const map = {
      accuracy: { min: 85, max: null, required_for_certification: true },
      smoke: { min: 100, max: null, required_for_certification: true }
    };
    const out = filterSimulatorSourcesForMandatory(SOURCES, map, new Set());
    expect(out).toHaveLength(2);
    expect(out[0].signals.map((s) => s.id)).toContain("accuracy");
    expect(out[1].signals.map((s) => s.id)).toContain("smoke");
    expect(out[0].sourceConnected).toBe(false);
  });

  it("marks sourceConnected when integration exists", () => {
    const map = { accuracy: { min: 85, required_for_certification: true } };
    const out = filterSimulatorSourcesForMandatory(SOURCES, map, new Set(["braintrust"]));
    expect(out).toHaveLength(1);
    expect(out[0].sourceConnected).toBe(true);
  });

  it("buildSimulatorThresholdMap merges local required flags", () => {
    localStorage.setItem("vdk3_thresholdRequired", JSON.stringify({ smoke: true }));
    const map = buildSimulatorThresholdMap({
      accuracy: { min: 85, max: null, required_for_certification: true }
    });
    expect(map.smoke.required_for_certification).toBe(true);
    expect(map.accuracy.required_for_certification).toBe(true);
    localStorage.removeItem("vdk3_thresholdRequired");
  });

  it("empty hint when nothing required", () => {
    const hint = getSimulatorEmptyHint({}, new Set(), SOURCES);
    expect(hint.title).toMatch(/No mandatory signals/);
    expect(countSimulatorEligibleRequired({})).toBe(0);
  });

  it("includes manual qa severity when showstopper is configured", () => {
    localStorage.setItem("vdk3_thresholds", JSON.stringify({ manual_qa_showstopper: "P0" }));
    const sources = [
      {
        id: "manual_qa",
        signals: [{ id: "manual_qa_pct" }, { id: "manual_qa_worst_severity" }]
      }
    ];
    const map = buildSimulatorThresholdMap({});
    const out = filterSimulatorSourcesForMandatory(sources, map, new Set());
    expect(out).toHaveLength(1);
    expect(out[0].signals.map((s) => s.id)).toContain("manual_qa_worst_severity");
    localStorage.removeItem("vdk3_thresholds");
  });
});
