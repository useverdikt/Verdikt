import { describe, it, expect, vi } from "vitest";
import { handleActivatableKeyDown } from "./keyboardActivate.js";
import { C } from "../theme/tokens.js";

function relativeLuminance(hex) {
  const raw = hex.replace("#", "");
  const rgb = [0, 2, 4].map((i) => parseInt(raw.slice(i, i + 2), 16) / 255);
  const lin = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(a, b) {
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

describe("trust-surface craft helpers", () => {
  it("meets WCAG AA contrast for dim text on the app background", () => {
    expect(contrast(C.dim, C.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(C.dim, C.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it("activates role=button rows on Enter and Space", () => {
    const onActivate = vi.fn();
    const preventDefault = vi.fn();
    handleActivatableKeyDown({ key: "Enter", preventDefault }, onActivate);
    handleActivatableKeyDown({ key: " ", preventDefault }, onActivate);
    handleActivatableKeyDown({ key: "Tab", preventDefault }, onActivate);
    expect(onActivate).toHaveBeenCalledTimes(2);
    expect(preventDefault).toHaveBeenCalledTimes(2);
  });
});
