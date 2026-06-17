import { describe, expect, it } from "vitest";
import {
  mapBackendStatusToUi,
  normalizeReleaseStatus,
  isIngestLocked,
  isLiveBypassRisk,
  shippedWithoutCertificationFlag,
  UI_RELEASE_STATUS
} from "./releaseStatus.js";

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

  it("detects live bypass risk for prod + non-cert-like status", () => {
    expect(
      isLiveBypassRisk({ environment: "prod", status: UI_RELEASE_STATUS.UNCERTIFIED })
    ).toBe(true);
    expect(
      isLiveBypassRisk({ environment: "prod", status: UI_RELEASE_STATUS.COLLECTING })
    ).toBe(true);
    expect(
      isLiveBypassRisk({ environment: "prod", status: UI_RELEASE_STATUS.CERTIFIED })
    ).toBe(false);
    expect(
      isLiveBypassRisk({ environment: "pre-prod", status: UI_RELEASE_STATUS.UNCERTIFIED })
    ).toBe(false);
  });

  it("reads frozen shipped_without_certification flag", () => {
    expect(shippedWithoutCertificationFlag({ shipped_without_certification: 1 })).toBe(true);
    expect(shippedWithoutCertificationFlag({ shipped_without_certification: true })).toBe(true);
    expect(shippedWithoutCertificationFlag({ shipped_without_certification: 0 })).toBe(false);
  });
});
