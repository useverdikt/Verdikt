import { describe, expect, it } from "vitest";
import { panelErrorMessage } from "./panelLoad.js";

describe("panelErrorMessage", () => {
  it("uses Error.message when present", () => {
    expect(panelErrorMessage(new Error("Unauthorized"))).toBe("Unauthorized");
  });

  it("falls back for unknown errors", () => {
    expect(panelErrorMessage(null)).toMatch(/Could not load data/);
  });
});
