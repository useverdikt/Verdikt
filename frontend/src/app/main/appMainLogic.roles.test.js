import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { canAct, DEFAULT_ROLE_POLICY, OVERRIDE_APPROVER_ROLES } from "./appMainLogic.js";

/**
 * Backend source of truth lives in middleware/auth.js as a Set.
 * Keep the frontend list aligned — a drift lets the inbox show Acknowledge
 * for a role the API will 403, or hide it for a role that can act.
 */
const BACKEND_OVERRIDE_APPROVER_ROLES = ["vp_engineering", "cto", "org_admin"];

describe("role policy matches backend authorization", () => {
  beforeEach(() => {
    localStorage.removeItem("vdk3_role_policy");
  });
  afterEach(() => {
    localStorage.removeItem("vdk3_role_policy");
  });

  it("lists the same override-approver roles the backend accepts", () => {
    expect([...OVERRIDE_APPROVER_ROLES].sort()).toEqual([...BACKEND_OVERRIDE_APPROVER_ROLES].sort());
    expect(OVERRIDE_APPROVER_ROLES).not.toContain("release_manager");
    expect(OVERRIDE_APPROVER_ROLES).not.toContain("engineer");
    expect(OVERRIDE_APPROVER_ROLES).not.toContain("viewer");
  });

  it("gives org_admin override/act and denies viewer", () => {
    expect(DEFAULT_ROLE_POLICY.org_admin.canOverride).toBe(true);
    expect(DEFAULT_ROLE_POLICY.org_admin.canAct).toBe(true);
    expect(canAct({ role: "org_admin" })).toBe(true);
    expect(DEFAULT_ROLE_POLICY.viewer.canOverride).toBe(false);
    expect(DEFAULT_ROLE_POLICY.viewer.canAct).toBe(false);
    expect(canAct({ role: "viewer" })).toBe(false);
  });

  it("fails open for a missing user or unknown role (legacy callers)", () => {
    expect(canAct(null)).toBe(true);
    expect(canAct({ role: "not_a_real_role" })).toBe(true);
  });
});
