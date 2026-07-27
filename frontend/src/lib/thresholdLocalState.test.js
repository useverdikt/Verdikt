import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("./hasBackend.js", () => ({
  hasBackend: vi.fn()
}));

import { hasBackend } from "./hasBackend.js";
import {
  readInitialThresholdUiState,
  persistThresholdUiState,
  clearThresholdLocalCache
} from "./thresholdLocalState.js";
import { DEFAULT_THRESHOLDS } from "./workspaceDefaults.js";
import { defaultRequiredFlags } from "./thresholdBounds.js";

describe("thresholdLocalState", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(hasBackend).mockReset();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("ignores poisoned localStorage when backend is connected", () => {
    vi.mocked(hasBackend).mockReturnValue(true);
    localStorage.setItem("vdk3_thresholds", JSON.stringify({ accuracy: 1 }));
    localStorage.setItem("vdk3_thresholdRequired", JSON.stringify({ accuracy: true }));

    const state = readInitialThresholdUiState();
    expect(state.thresholds).toEqual(DEFAULT_THRESHOLDS);
    expect(state.thresholds.accuracy).not.toBe(1);
    expect(state.required).toEqual(defaultRequiredFlags());
  });

  it("hydrates from localStorage in offline/demo mode", () => {
    vi.mocked(hasBackend).mockReturnValue(false);
    localStorage.setItem("vdk3_thresholds", JSON.stringify({ accuracy: 91 }));
    localStorage.setItem("vdk3_thresholdRequired", JSON.stringify({ accuracy: true }));

    const state = readInitialThresholdUiState();
    expect(state.thresholds.accuracy).toBe(91);
    expect(state.required.accuracy).toBe(true);
  });

  it("does not persist thresholds when backend is connected", () => {
    vi.mocked(hasBackend).mockReturnValue(true);
    const wrote = persistThresholdUiState({ accuracy: 88 }, { accuracy: true });
    expect(wrote).toBe(false);
    expect(localStorage.getItem("vdk3_thresholds")).toBeNull();
    expect(localStorage.getItem("vdk3_thresholdRequired")).toBeNull();
  });

  it("persists thresholds in offline/demo mode", () => {
    vi.mocked(hasBackend).mockReturnValue(false);
    const wrote = persistThresholdUiState({ accuracy: 88 }, { accuracy: true });
    expect(wrote).toBe(true);
    expect(JSON.parse(localStorage.getItem("vdk3_thresholds"))).toEqual({ accuracy: 88 });
    expect(JSON.parse(localStorage.getItem("vdk3_thresholdRequired"))).toEqual({ accuracy: true });
  });

  it("clears threshold local cache keys", () => {
    localStorage.setItem("vdk3_thresholds", "{}");
    localStorage.setItem("vdk3_thresholdRequired", "{}");
    clearThresholdLocalCache();
    expect(localStorage.getItem("vdk3_thresholds")).toBeNull();
    expect(localStorage.getItem("vdk3_thresholdRequired")).toBeNull();
  });
});
