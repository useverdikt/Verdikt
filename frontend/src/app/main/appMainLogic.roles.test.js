import { describe, expect, it } from "vitest";
import { canAct, DEFAULT_ROLE_POLICY, OVERRIDE_APPROVER_ROLES } from "./appMainLogic.js";

describe("role policy matches backend authorization", () => {
  it("offers escalation override only to roles the backend accepts", () => {
    expect([...OVERRIDE_APPROVER_ROLES].sort()).toEqual(["cto", "org_admin", "vp_engineering"]);
    expect(OVERRIDE_APPROVER_ROLES).not.toContain("release_manager");
  });

  it("knows org_admin and viewer", () => {
    expect(DEFAULT_ROLE_POLICY.org_admin.canOverride).toBe(true);
    expect(canAct({ role: "org_admin" })).toBe(true);
    expect(canAct({ role: "viewer" })).toBe(false);
  });
});
