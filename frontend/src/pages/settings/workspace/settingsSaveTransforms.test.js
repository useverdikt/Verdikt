import { describe, expect, it } from "vitest";
import { THRESH_DEFAULTS } from "../settingsData.js";
import {
  normalizeThresholdsStateForSave,
  thresholdNormalizedToApiPayload,
  slugifyWorkspaceSlug,
  normalizeApiBaseOrigin
} from "./settingsSaveTransforms.js";

describe("slugifyWorkspaceSlug", () => {
  it("lowercases and replaces non-alphanumeric runs with hyphens", () => {
    expect(slugifyWorkspaceSlug("  Acme AI Labs  ")).toBe("acme-ai-labs");
  });

  it("trims edge hyphens", () => {
    expect(slugifyWorkspaceSlug("---foo---")).toBe("foo");
  });
});

describe("normalizeApiBaseOrigin", () => {
  it("returns origin for https URL", () => {
    expect(normalizeApiBaseOrigin("https://api.example.com/v1")).toBe("https://api.example.com");
  });

  it("strips trailing slash before parsing", () => {
    expect(normalizeApiBaseOrigin("http://localhost:8787/")).toBe("http://localhost:8787");
  });

  it("returns null for empty or invalid", () => {
    expect(normalizeApiBaseOrigin("")).toBeNull();
    expect(normalizeApiBaseOrigin("not a url")).toBeNull();
  });
});

describe("normalizeThresholdsStateForSave", () => {
  it("coerces numeric fields and preserves string defaults", () => {
    const ui = {
      ...THRESH_DEFAULTS,
      smoke: "99",
      manual_qa_showstopper: "P1",
      p95latency: ""
    };
    const t = normalizeThresholdsStateForSave(THRESH_DEFAULTS, ui);
    expect(t.smoke).toBe(99);
    expect(t.manual_qa_showstopper).toBe("P1");
    expect(t.p95latency).toBe(THRESH_DEFAULTS.p95latency);
  });
});

describe("thresholdNormalizedToApiPayload", () => {
  it("maps numeric thresholds to min/max shape; latency uses max", () => {
    const t = normalizeThresholdsStateForSave(THRESH_DEFAULTS, THRESH_DEFAULTS);
    const payload = thresholdNormalizedToApiPayload(t);
    expect(payload.smoke).toEqual({ min: THRESH_DEFAULTS.smoke, max: null });
    expect(payload.p95latency).toEqual({ min: null, max: THRESH_DEFAULTS.p95latency });
    expect(payload.manual_qa_showstopper).toBeUndefined();
  });
});
