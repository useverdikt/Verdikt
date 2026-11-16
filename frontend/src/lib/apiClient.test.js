import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiGet, apiPost, apiFetchInit } from "./apiClient.js";
import { appQueryClient } from "../queries/queryClient.js";

describe("apiClient", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    localStorage.clear();
    document.cookie = "vdk_csrf=; Max-Age=0; path=/";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("fetch not stubbed for this test");
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
    localStorage.clear();
    document.cookie = "vdk_csrf=; Max-Age=0; path=/";
  });

  it("prefers JSON message and attaches x-request-id", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 400,
      headers: {
        get: (name) => (name.toLowerCase() === "x-request-id" ? "req-abc" : null)
      },
      json: async () => ({ error: "bad_request", message: "Threshold out of range" })
    }));

    await expect(apiGet("/api/workspaces/ws_x/thresholds")).rejects.toMatchObject({
      name: "ApiError",
      status: 400,
      code: "bad_request",
      requestId: "req-abc",
      message: "Threshold out of range (request_id: req-abc)"
    });
  });

  it("falls back to error field and body request_id when header missing", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 404,
      headers: { get: () => null },
      json: async () => ({ error: "not_found", request_id: "body-rid" })
    }));

    await expect(apiGet("/api/missing")).rejects.toMatchObject({
      name: "ApiError",
      status: 404,
      code: "not_found",
      requestId: "body-rid",
      message: "not_found (request_id: body-rid)"
    });
  });

  it("attaches details from the standardized error body", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 409,
      headers: { get: () => null },
      json: async () => ({
        error: "not_pending",
        message: "Escalation is not pending review",
        request_id: "rid-1",
        details: { state: "resolved" }
      })
    }));

    await expect(apiGet("/api/workspaces/ws/escalations/x/acknowledge")).rejects.toMatchObject({
      name: "ApiError",
      status: 409,
      code: "not_pending",
      details: { state: "resolved" },
      message: "Escalation is not pending review (request_id: rid-1)"
    });
  });

  it("apiFetchInit includes credentials, decoded CSRF, and never a Bearer header", () => {
    document.cookie = "vdk_csrf=a%2Bb";
    const init = apiFetchInit({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    expect(init.credentials).toBe("include");
    expect(init.headers["X-CSRF-Token"]).toBe("a+b");
    expect(init.headers.Authorization).toBeUndefined();
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("401 clears session state, posts logout, navigates, and still rejects", async () => {
    localStorage.setItem("vdk3_currentUser", JSON.stringify({ email: "x@y.z" }));
    appQueryClient.setQueryData(["workspace", "ws"], { ok: true });
    const navigate = vi.fn();
    const fetchMock = vi.fn(async (url, init) => {
      if (String(url).includes("/api/auth/logout")) {
        return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({}) };
      }
      return {
        ok: false,
        status: 401,
        headers: { get: () => null },
        json: async () => ({ error: "unauthorized" })
      };
    });
    globalThis.fetch = fetchMock;

    await expect(apiPost("/api/workspaces/ws/thresholds", {}, { navigate })).rejects.toMatchObject({
      name: "ApiError",
      status: 401
    });

    expect(localStorage.getItem("vdk3_currentUser")).toBeNull();
    expect(appQueryClient.getQueryData(["workspace", "ws"])).toBeUndefined();
    expect(navigate).toHaveBeenCalledWith("/login", { replace: true });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/auth/logout"))).toBe(true);
  });
});
