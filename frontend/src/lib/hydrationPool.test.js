import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  enqueue,
  awaitReleaseDetail,
  reset,
  setHydrationNavigate,
  setOnEach,
  _peekQueueIdsForTests,
  _resetHydrationPoolForTests
} from "./hydrationPool.js";

vi.mock("./releaseDetailApi.js", () => ({
  fetchAndMapReleaseDetail: vi.fn()
}));

import { fetchAndMapReleaseDetail } from "./releaseDetailApi.js";

const mapped = (id) => ({
  backendReleaseId: id,
  detailLoaded: true,
  version: "v1"
});

describe("hydrationPool", () => {
  beforeEach(() => {
    _resetHydrationPoolForTests();
    vi.mocked(fetchAndMapReleaseDetail).mockReset();
    setHydrationNavigate(vi.fn());
    setOnEach(null);
  });

  it("caps concurrent workers at six", async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    vi.mocked(fetchAndMapReleaseDetail).mockImplementation(
      () =>
        new Promise((resolve) => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          setTimeout(() => {
            inFlight -= 1;
            resolve(mapped("rel_x"));
          }, 30);
        })
    );

    const ids = Array.from({ length: 12 }, (_, i) => `rel_${i}`);
    enqueue(ids, { priority: false });

    await vi.waitFor(() => {
      expect(maxInFlight).toBeLessThanOrEqual(6);
      expect(fetchAndMapReleaseDetail).toHaveBeenCalledTimes(12);
    });
  });

  it("splices priority ids to the front of a shared queue", async () => {
    let release;
    const hold = new Promise((resolve) => {
      release = resolve;
    });

    vi.mocked(fetchAndMapReleaseDetail).mockImplementation(() => hold.then(() => mapped("x")));

    enqueue(
      ["rel_0", "rel_1", "rel_2", "rel_3", "rel_4", "rel_5"],
      { priority: false }
    );
    enqueue(["rel_chart"], { priority: true });
    enqueue(["rel_b"], { priority: false });

    expect(_peekQueueIdsForTests()).toEqual(["rel_chart", "rel_b"]);

    release();
    await vi.waitFor(() => vi.mocked(fetchAndMapReleaseDetail).mock.calls.length === 8);
  });

  it("dedupes concurrent awaitReleaseDetail for the same id", async () => {
    vi.mocked(fetchAndMapReleaseDetail).mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve(mapped("rel_1")), 20);
        })
    );

    const navigate = vi.fn();
    setHydrationNavigate(navigate);

    const [a, b] = await Promise.all([
      awaitReleaseDetail("rel_1", { priority: true }),
      awaitReleaseDetail("rel_1", { priority: true })
    ]);

    expect(fetchAndMapReleaseDetail).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(a?.backendReleaseId).toBe("rel_1");
  });

  it("reset resolves in-flight awaitReleaseDetail waiters with null", async () => {
    let release;
    const hold = new Promise((resolve) => {
      release = resolve;
    });

    vi.mocked(fetchAndMapReleaseDetail).mockImplementation(() => hold.then(() => mapped("rel_1")));

    const pending = awaitReleaseDetail("rel_1", { priority: true });
    reset();
    setHydrationNavigate(vi.fn());

    await expect(pending).resolves.toBeNull();

    release();
  });

  it("reset clears hydrated state so ids can be fetched again", async () => {
    vi.mocked(fetchAndMapReleaseDetail).mockResolvedValue(mapped("rel_1"));

    await awaitReleaseDetail("rel_1");
    expect(fetchAndMapReleaseDetail).toHaveBeenCalledTimes(1);

    _resetHydrationPoolForTests();
    setHydrationNavigate(vi.fn());

    await awaitReleaseDetail("rel_1");
    expect(fetchAndMapReleaseDetail).toHaveBeenCalledTimes(2);
  });
});
