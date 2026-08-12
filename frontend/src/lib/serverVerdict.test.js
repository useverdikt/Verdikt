import { describe, expect, it } from "vitest";
import {
  categoryStatusFromFailedIds,
  displayRecommendationFromStatus,
  failingSignalsForDisplay,
  hasServerFailedSignalList,
  isHardBlockFromRelease,
  serverFailedSignalIds,
  shouldUseServerFailedSignals
} from "./serverVerdict.js";

describe("displayRecommendationFromStatus", () => {
  it("uses stored status, not live signal math", () => {
    expect(displayRecommendationFromStatus("CERTIFIED")).toBe("SHIP");
    expect(displayRecommendationFromStatus("certified")).toBe("SHIP");
    expect(displayRecommendationFromStatus("CERTIFIED_WITH_OVERRIDE")).toBe("SHIP");
    expect(displayRecommendationFromStatus("overridden")).toBe("SHIP");
    expect(displayRecommendationFromStatus("UNCERTIFIED")).toBe("BLOCK");
    expect(displayRecommendationFromStatus("COLLECTING")).toBe("COLLECTING");
  });
});

describe("server failed-signal lists", () => {
  it("treats an empty intelligence list as authoritative", () => {
    const release = { intelligence: { verdict: { failed_signals: [] } } };
    expect(hasServerFailedSignalList(release)).toBe(true);
    expect(serverFailedSignalIds(release).size).toBe(0);
    expect(failingSignalsForDisplay(release)).toEqual([]);
  });

  it("maps persisted failures to display rows", () => {
    const release = {
      intelligence: {
        verdict: {
          failed_signals: [
            { signal_id: "accuracy", value: 80, rule: ">= 85", failure_kind: "absolute_threshold" }
          ]
        }
      }
    };
    const rows = failingSignalsForDisplay(release, {
      definitions: [{ signal_id: "accuracy", display_name: "Accuracy", direction: "min", unit: "%" }]
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].sigId).toBe("accuracy");
    expect(rows[0].sigLabel).toBe("Accuracy");
    expect(rows[0].value).toBe(80);
    expect(rows[0].threshold).toBe(85);
    expect(rows[0].direction).toBe("above");
  });

  it("does not invent failures for a backend release with no list yet", () => {
    const release = { backendReleaseId: "rel_1", signals: { accuracy: 10 } };
    expect(hasServerFailedSignalList(release)).toBe(false);
    expect(failingSignalsForDisplay(release, { demoFallback: () => [{ sigId: "invented" }] })).toEqual([]);
  });

  it("uses demoFallback only when there is no backend id and no server list", () => {
    const rows = failingSignalsForDisplay(
      { signals: { accuracy: 10 } },
      { demoFallback: () => [{ sigId: "accuracy", sigLabel: "Accuracy" }] }
    );
    expect(rows[0].sigId).toBe("accuracy");
  });

  it("flags high-risk intelligence as a hard block", () => {
    expect(isHardBlockFromRelease({ intelligence: { verdict: { risk_level: "HIGH", failed_signals: [] } } })).toBe(true);
    expect(isHardBlockFromRelease({ intelligence: { verdict: { risk_level: "LOW", failed_signals: [] } } })).toBe(false);
  });

  it("uses server failures for verdicted releases, not collecting", () => {
    const lastEval = { last_signal_evaluation: { failed_signals: [{ signal_id: "accuracy" }] } };
    expect(shouldUseServerFailedSignals({ status: "COLLECTING", ...lastEval })).toBe(false);
    expect(shouldUseServerFailedSignals({ status: "CERTIFIED", ...lastEval })).toBe(true);
    expect(shouldUseServerFailedSignals({ status: "UNCERTIFIED", ...lastEval })).toBe(true);
    expect(shouldUseServerFailedSignals({ status: "CERTIFIED" })).toBe(false);
    expect(shouldUseServerFailedSignals(null)).toBe(false);
  });

  it("does not freeze collecting failing rows to the last ingest audit", () => {
    const release = {
      status: "COLLECTING",
      backendReleaseId: "rel_1",
      last_signal_evaluation: { failed_signals: [{ signal_id: "accuracy" }] }
    };
    expect(hasServerFailedSignalList(release)).toBe(true);
    expect(shouldUseServerFailedSignals(release)).toBe(false);
    const rows = failingSignalsForDisplay(release, {
      demoFallback: () => [{ sigId: "safety", sigLabel: "Safety" }]
    });
    expect(rows[0].sigId).toBe("safety");
  });

  it("rolls category status from failed ids", () => {
    const cat = { id: "ai", signals: [{ id: "accuracy" }, { id: "safety" }] };
    const release = {
      signals: { accuracy: 80, safety: 95 },
      intelligence: { verdict: { failed_signals: [{ signal_id: "accuracy" }] } }
    };
    expect(categoryStatusFromFailedIds(cat, release)).toBe("fail");
    expect(
      categoryStatusFromFailedIds(cat, {
        signals: { accuracy: 90, safety: 95 },
        intelligence: { verdict: { failed_signals: [] } }
      })
    ).toBe("pass");
  });
});
