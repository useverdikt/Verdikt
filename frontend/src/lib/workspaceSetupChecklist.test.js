import { describe, it, expect } from "vitest";
import { buildWorkspaceSetupChecklist } from "./workspaceSetupChecklist.js";
import { emptyReleasesWedgeCopy, WAITING_FOR_FIRST_PR_TITLE } from "./firstCertCopy.js";

describe("workspace setup checklist", () => {
  it("is incomplete until github, signals, and thresholds are ready", () => {
    const built = buildWorkspaceSetupChecklist({
      githubConnected: true,
      labelTriggerEnabled: true,
      signalsConnected: false,
      signalDefinitions: [{ signal_id: "accuracy" }]
    });
    expect(built.complete).toBe(false);
    expect(built.items.find((i) => i.id === "signals").done).toBe(false);
  });

  it("is complete when github trigger, a signal source, and adopted thresholds exist", () => {
    const built = buildWorkspaceSetupChecklist({
      githubConnected: true,
      labelTriggerEnabled: true,
      signalsConnected: true,
      signalDefinitions: [{ signal_id: "accuracy" }],
      triggerLabel: "verdikt:rc"
    });
    expect(built.complete).toBe(true);
    expect(built.triggerLabel).toBe("verdikt:rc");
  });

  it("points the empty list at labeling a PR, not adding a release", () => {
    expect(emptyReleasesWedgeCopy("verdikt:rc")).toMatch(/Label a PR verdikt:rc/);
    expect(emptyReleasesWedgeCopy()).not.toMatch(/Add one to get started/);
    expect(WAITING_FOR_FIRST_PR_TITLE).toMatch(/Waiting for your first PR/);
  });
});
