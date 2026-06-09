import { describe, expect, it } from "vitest";
import { mapBackendStatusToUi, normalizeReleaseStatus, isIngestLocked, UI_RELEASE_STATUS } from "./releaseStatus.js";

describe("releaseStatus", () => {
  it("maps backend statuses 1:1 to UI slugs", () => {
    expect(mapBackendStatusToUi("COLLECTING")).toBe("collecting");
    expect(mapBackendStatusToUi("CERTIFIED")).toBe("certified");
    expect(mapBackendStatusToUi("UNCERTIFIED")).toBe("uncertified");
    expect(mapBackendStatusToUi("CERTIFIED_WITH_OVERRIDE")).toBe("overridden");
  });

  it("normalizes UI statuses strictly", () => {
    expect(normalizeReleaseStatus("uncertified")).toBe("uncertified");
    expect(normalizeReleaseStatus("collecting")).toBe("collecting");
    expect(normalizeReleaseStatus("UNCERTIFIED")).toBe("uncertified");
  });

  it("does not treat pending or blocked as release statuses", () => {
    expect(normalizeReleaseStatus("pending")).toBe("uncertified");
    expect(normalizeReleaseStatus("blocked")).toBe("uncertified");
    expect(normalizeReleaseStatus("shipped")).toBe("uncertified");
  });

  it("locks ingest only for certified verdicts", () => {
    expect(isIngestLocked("UNCERTIFIED")).toBe(false);
    expect(isIngestLocked("COLLECTING")).toBe(false);
    expect(isIngestLocked("CERTIFIED")).toBe(true);
    expect(isIngestLocked("CERTIFIED_WITH_OVERRIDE")).toBe(true);
  });
});
