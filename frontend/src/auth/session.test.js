import { describe, it, expect, beforeEach } from "vitest";
import { AUTH_TOKEN_KEY, getStoredJwt, isAuthenticated, clearAuthSession } from "./session.js";

describe("session helpers", () => {
  beforeEach(() => {
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem("vdk3_currentUser");
  });

  it("getStoredJwt always null (JWT is HttpOnly only)", () => {
    expect(getStoredJwt()).toBe(null);
  });

  it("isAuthenticated reflects cached user snapshot only", () => {
    expect(isAuthenticated()).toBe(false);
    localStorage.setItem("vdk3_currentUser", "{}");
    expect(isAuthenticated()).toBe(true);
  });

  it("clearAuthSession removes legacy token key and user snapshot", () => {
    localStorage.setItem(AUTH_TOKEN_KEY, "x");
    localStorage.setItem("vdk3_currentUser", "{}");
    clearAuthSession();
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBe(null);
    expect(localStorage.getItem("vdk3_currentUser")).toBe(null);
  });
});
