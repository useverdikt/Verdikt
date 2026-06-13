import { describe, expect, it, vi } from "vitest";
import { createWorkspaceResourceCache } from "./workspaceResourceCache.js";

describe("workspaceResourceCache", () => {
  it("dedupes concurrent fetches for the same workspace", async () => {
    const apiFetch = vi.fn(
      () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 20))
    );
    const cache = createWorkspaceResourceCache({ pathFor: (id) => `/api/w/${id}/x`, ttlMs: 60_000 });

    const [a, b] = await Promise.all([cache.fetch("ws_1", apiFetch), cache.fetch("ws_1", apiFetch)]);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it("returns cached data within TTL without refetching", async () => {
    const apiFetch = vi.fn().mockResolvedValue({ n: 1 });
    const cache = createWorkspaceResourceCache({ pathFor: (id) => `/api/w/${id}/x`, ttlMs: 60_000 });

    await cache.fetch("ws_1", apiFetch);
    await cache.fetch("ws_1", apiFetch);
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(cache.getCached("ws_1")).toEqual({ n: 1 });
  });
});
