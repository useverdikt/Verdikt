import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiGet } from "./apiClient.js";

describe("apiClient error contract", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
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
});
