import { describe, expect, it } from "vitest";
import { LIST_SIGNAL_DOT_CAP, summarizeListSignalOutcomes } from "./releaseDashboardUtils.js";

const signalCategories = [
  {
    id: "ai_quality",
    label: "AI quality",
    signals: [
      { id: "accuracy", label: "Accuracy", direction: "above", unit: "%" },
      { id: "safety", label: "Safety", direction: "above", unit: "%" }
    ]
  },
  {
    id: "performance",
    label: "Performance",
    signals: [{ id: "p95latency", label: "P95 latency", direction: "below", unit: "ms" }]
  }
];

describe("summarizeListSignalOutcomes", () => {
  it("counts evaluated signals instead of five category rollups", () => {
    const summary = summarizeListSignalOutcomes({
      signalCategories,
      releaseSignals: {
        accuracy: 92,
        safety: 91,
        p95latency: 120
      },
      thresholds: {
        accuracy: 90,
        safety: 90,
        p95latency: 200
      },
      releaseType: "model_update",
      releaseTypes: []
    });

    expect(summary.evaluatedCount).toBe(3);
    expect(summary.passCount).toBe(3);
    expect(summary.failCount).toBe(0);
    expect(summary.dots).toEqual(["p", "p", "p"]);
  });

  it("includes workspace custom definitions and ingested-only signals", () => {
    const summary = summarizeListSignalOutcomes({
      signalDefinitions: [
        {
          signal_id: "behavioural_drift",
          display_name: "Behavioural Drift",
          direction: "max",
          unit: "score"
        }
      ],
      signalCategories,
      releaseSignals: {
        behavioural_drift: 0.12,
        custom_metric: 15
      },
      thresholds: {
        behavioural_drift: 0.15,
        custom_metric: 10
      },
      releaseType: "model_update",
      releaseTypes: []
    });

    expect(summary.evaluatedCount).toBe(2);
    expect(summary.passCount).toBe(1);
    expect(summary.failCount).toBe(1);
    expect(summary.dots).toEqual(["p", "f"]);
  });

  it("caps visible dots and reports overflow", () => {
    const releaseSignals = {};
    const thresholds = {};
    const signalDefinitions = [];

    for (let i = 0; i < LIST_SIGNAL_DOT_CAP + 3; i += 1) {
      const id = `metric_${i}`;
      signalDefinitions.push({
        signal_id: id,
        display_name: `Metric ${i}`,
        direction: "min",
        unit: "%"
      });
      releaseSignals[id] = 95;
      thresholds[id] = 90;
    }

    const summary = summarizeListSignalOutcomes({
      signalDefinitions,
      signalCategories: [],
      releaseSignals,
      thresholds,
      releaseType: "model_update",
      releaseTypes: []
    });

    expect(summary.evaluatedCount).toBe(LIST_SIGNAL_DOT_CAP + 3);
    expect(summary.dots).toHaveLength(LIST_SIGNAL_DOT_CAP);
    expect(summary.overflow).toBe(3);
  });
});
