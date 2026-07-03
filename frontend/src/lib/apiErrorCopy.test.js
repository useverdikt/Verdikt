import { describe, it, expect } from "vitest";
import { resolveApiBanner } from "./apiErrorCopy.js";

describe("resolveApiBanner", () => {
  it("maps threshold errors to friendly title", () => {
    const out = resolveApiBanner("Failed to save thresholds: 500");
    expect(out.title).toBe("Couldn't save thresholds");
    expect(out.detail).toContain("500");
  });

  it("maps ingest errors", () => {
    const out = resolveApiBanner("Signal ingest failed");
    expect(out.title).toBe("Couldn't apply signals to this release");
  });

  it("falls back to generic title for unknown errors", () => {
    const out = resolveApiBanner("ECONNRESET");
    expect(out.title).toBe("Something went wrong — try again");
    expect(out.detail).toBe("ECONNRESET");
  });

  it("returns null for empty input", () => {
    expect(resolveApiBanner(null)).toBe(null);
    expect(resolveApiBanner("   ")).toBe(null);
  });
});
