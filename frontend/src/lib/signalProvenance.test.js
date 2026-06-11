import { describe, it, expect } from "vitest";
import {
  classifySignalSource,
  getEvidenceSummaryLine,
  latestSignalRowMap
} from "./signalProvenance.js";

describe("signalProvenance", () => {
  it("classifies tiers", () => {
    expect(classifySignalSource("pulled:braintrust")).toBe("integration");
    expect(classifySignalSource("simulator:manual_qa")).toBe("simulator");
    expect(classifySignalSource("agent")).toBe("programmatic");
  });

  it("builds evidence summary line from signal rows", () => {
    const release = {
      signalRows: [
        { id: 2, signal_id: "accuracy", source: "pulled:braintrust" },
        { id: 1, signal_id: "smoke", source: "simulator:browserstack" }
      ]
    };
    const line = getEvidenceSummaryLine(release);
    expect(line).toContain("integration pull");
    expect(line).toContain("Signal Simulator");
  });

  it("picks latest row by id", () => {
    const map = latestSignalRowMap([
      { id: 2, signal_id: "accuracy", source: "pulled:braintrust" },
      { id: 1, signal_id: "accuracy", source: "simulator:braintrust" }
    ]);
    expect(map.accuracy.source).toBe("pulled:braintrust");
  });
});
