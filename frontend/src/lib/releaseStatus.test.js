import { describe, expect, it } from "vitest";
import { mapBackendStatusToUi, normalizeLegacyUiStatus, UI_RELEASE_STATUS } from "./releaseStatus.js";

describe("releaseStatus", () => {
  it("maps backend statuses 1:1 to UI slugs", () => {
    expect(mapBackendStatusToUi("COLLECTING")).toBe("collecting");
    expect(mapBackendStatusToUi("CERTIFIED")).toBe("certified");
    expect(mapBackendStatusToUi("UNCERTIFIED")).toBe("uncertified");
    expect(mapBackendStatusToUi("CERTIFIED_WITH_OVERRIDE")).toBe("overridden");
  });

  it("normalizes legacy UI aliases", () => {
    expect(normalizeLegacyUiStatus("shipped")).toBe(UI_RELEASE_STATUS.CERTIFIED);
    expect(normalizeLegacyUiStatus("blocked")).toBe(UI_RELEASE_STATUS.UNCERTIFIED);
    expect(normalizeLegacyUiStatus("pending")).toBe(UI_RELEASE_STATUS.UNCERTIFIED);
  });
});
