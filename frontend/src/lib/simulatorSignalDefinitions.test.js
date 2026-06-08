import { describe, expect, it } from "vitest";
import {
  SIMULATOR_SOURCES,
  buildSimulatorIngestPayload,
  passesSimulatorSignal,
  applySimulatorThresholds
} from "./simulatorSignalDefinitions.js";

describe("simulatorSignalDefinitions", () => {
  it("includes full datadog and manual qa catalogs", () => {
    const datadog = SIMULATOR_SOURCES.find((s) => s.id === "datadog");
    const manualQa = SIMULATOR_SOURCES.find((s) => s.id === "manual_qa");
    expect(datadog.signals.map((s) => s.id)).toEqual(
      expect.arrayContaining(["startup", "screenload", "fps", "p95latency", "p99latency"])
    );
    expect(manualQa.signals.map((s) => s.id)).toEqual(["manual_qa_pct", "manual_qa_worst_severity"]);
  });

  it("encodes severity ingest as numeric index", () => {
    const manualQa = SIMULATOR_SOURCES.find((s) => s.id === "manual_qa");
    const payload = buildSimulatorIngestPayload(manualQa, {
      manual_qa_pct: 97,
      manual_qa_worst_severity: "P1"
    });
    expect(payload.manual_qa_pct).toBe(97);
    expect(payload.manual_qa_worst_severity).toBe(4);
  });

  it("evaluates showstopper severity against configured policy", () => {
    const sources = applySimulatorThresholds(SIMULATOR_SOURCES, {
      manual_qa_worst_severity: { min: null, max: 4 }
    }, { manual_qa_showstopper: "P0" });
    const severitySig = sources.find((s) => s.id === "manual_qa").signals.find((s) => s.id === "manual_qa_worst_severity");
    expect(passesSimulatorSignal(severitySig, "P2")).toBe(true);
    expect(passesSimulatorSignal(severitySig, "P0")).toBe(false);
  });
});
