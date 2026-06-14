import { describe, expect, it, beforeEach } from "vitest";
import { readWorkspaceProdObservation, writeWorkspaceProdObservation } from "./workspacePrefs.js";

describe("workspacePrefs", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stores prodObservation per workspace", () => {
    writeWorkspaceProdObservation("ws_a", true);
    writeWorkspaceProdObservation("ws_b", false);
    expect(readWorkspaceProdObservation("ws_a")).toBe(true);
    expect(readWorkspaceProdObservation("ws_b")).toBe(false);
  });

  it("survives vdk3_project removal (workspace switch cache clear)", () => {
    writeWorkspaceProdObservation("ws_a", true);
    localStorage.removeItem("vdk3_project");
    expect(readWorkspaceProdObservation("ws_a")).toBe(true);
  });

  it("falls back to legacy vdk3_project when workspace prefs missing", () => {
    localStorage.setItem("vdk3_project", JSON.stringify({ prodObservation: true }));
    expect(readWorkspaceProdObservation("ws_legacy")).toBe(true);
  });
});
