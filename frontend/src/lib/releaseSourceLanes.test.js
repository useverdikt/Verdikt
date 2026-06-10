import { describe, expect, it } from "vitest";
import { buildReleaseSourceLanes, integrationPullBannerWarnings } from "./releaseSourceLanes.js";

describe("releaseSourceLanes", () => {
  it("marks configured source awaiting SHA when pull failed", () => {
    const lanes = buildReleaseSourceLanes({
      connectedIntegrationIds: ["braintrust"],
      signalRows: [],
      integrationPull: {
        warnings: [{ source: "braintrust", message: "Braintrust: no experiment matched" }],
        results: { braintrust: { ok: false } }
      },
      releaseStatus: "COLLECTING"
    });
    const bt = lanes.find((l) => l.id === "braintrust");
    expect(bt.connectionStatus).toBe("pull_failed");
    expect(bt.statusLabel).toMatch(/pull failed/i);
  });

  it("marks received when signal row exists for source", () => {
    const lanes = buildReleaseSourceLanes({
      connectedIntegrationIds: ["braintrust"],
      signalRows: [{ signal_id: "accuracy", value: 90, source: "pulled:braintrust" }],
      releaseStatus: "COLLECTING"
    });
    const bt = lanes.find((l) => l.id === "braintrust");
    expect(bt.connectionStatus).toBe("received");
  });

  it("extracts banner warning messages", () => {
    const msgs = integrationPullBannerWarnings({
      warnings: [{ message: "Tag eval runs with git_sha" }]
    });
    expect(msgs[0]).toMatch(/git_sha/);
  });
});
