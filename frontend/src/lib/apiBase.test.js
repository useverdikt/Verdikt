import { describe, it, expect, beforeEach } from "vitest";
import { getSafeApiBase } from "./apiBase.js";

const LS_KEY = "vdk3_api_base";

describe("getSafeApiBase", () => {
  beforeEach(() => {
    localStorage.removeItem(LS_KEY);
  });

  it("returns empty string when no override is set", () => {
    const base = getSafeApiBase();
    expect(base).toBe("");
  });

  it("normalizes a valid https origin from localStorage", () => {
    localStorage.setItem(LS_KEY, "https://api.example.com/");
    expect(getSafeApiBase()).toBe("https://api.example.com");
  });

  it("rejects non-http(s) URLs and falls back", () => {
    localStorage.setItem(LS_KEY, "ftp://bad.example.com");
    const base = getSafeApiBase();
    expect(base === "" || base.startsWith("http")).toBe(true);
  });
});
