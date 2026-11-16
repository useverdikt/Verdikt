import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getSafeApiBase } from "./apiBase.js";

const LS_KEY = "vdk3_api_base";

describe("getSafeApiBase", () => {
  beforeEach(() => {
    localStorage.removeItem(LS_KEY);
  });

  afterEach(() => {
    localStorage.removeItem(LS_KEY);
    vi.unstubAllEnvs();
  });

  it("returns empty string when no override is set", () => {
    expect(getSafeApiBase()).toBe("");
  });

  it("normalizes a valid https origin from localStorage in DEV", () => {
    vi.stubEnv("DEV", true);
    localStorage.setItem(LS_KEY, "https://api.example.com/");
    expect(getSafeApiBase()).toBe("https://api.example.com");
  });

  it("rejects non-http(s) URLs and does not return the ftp value", () => {
    vi.stubEnv("DEV", true);
    localStorage.setItem(LS_KEY, "ftp://bad.example.com");
    const base = getSafeApiBase();
    expect(base).not.toMatch(/^ftp:/i);
    expect(base === "" || base.startsWith("http")).toBe(true);
  });

  it("ignores localStorage overrides when DEV is false", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_API_BASE", "https://prod-api.useverdikt.com");
    localStorage.setItem(LS_KEY, "https://attacker.example");
    expect(getSafeApiBase()).toBe("https://prod-api.useverdikt.com");
  });
});
