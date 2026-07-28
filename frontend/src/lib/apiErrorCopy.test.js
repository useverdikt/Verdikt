import { describe, it, expect } from "vitest";
import { resolveApiBanner, messageFromApiBody } from "./apiErrorCopy.js";

describe("messageFromApiBody", () => {
  it("prefers message over machine-code error", () => {
    expect(
      messageFromApiBody({ error: "unauthorized", message: "Invalid email or password" }, "fail")
    ).toBe("Invalid email or password");
  });

  it("falls back to error then default", () => {
    expect(messageFromApiBody({ error: "not_found" })).toBe("not_found");
    expect(messageFromApiBody({})).toBe("Request failed");
    expect(messageFromApiBody(null, "Sign in failed")).toBe("Sign in failed");
  });
});

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
