import { describe, expect, it } from "vitest";
import { formatCertTiersShort, normalizeStoredProject, primaryCertEnvFromTiers } from "./projectEnv.js";

describe("primaryCertEnvFromTiers", () => {
  it("prefers staging when both staging and uat are present", () => {
    expect(primaryCertEnvFromTiers(["uat", "staging"])).toBe("staging");
  });

  it("returns uat when only uat", () => {
    expect(primaryCertEnvFromTiers(["uat"])).toBe("uat");
  });

  it("defaults to uat when tier set is empty", () => {
    expect(primaryCertEnvFromTiers([])).toBe("uat");
  });

  it("returns staging when only staging is present", () => {
    expect(primaryCertEnvFromTiers(["staging"])).toBe("staging");
  });
});

describe("normalizeStoredProject", () => {
  it("maps certEnvs to ordered staging/uat and sets env label from primary tier", () => {
    const n = normalizeStoredProject({ certEnvs: ["uat", "staging"], prodObservation: false });
    expect(n.certEnvs).toEqual(["staging", "uat"]);
    expect(n.env).toBe("STAGING");
    expect(n.prodObservation).toBe(false);
  });

  it("defaults prod-like env to uat tier when no certEnvs", () => {
    expect(normalizeStoredProject({ env: "production" }).certEnvs).toEqual(["uat"]);
    expect(normalizeStoredProject({ env: "prod" }).env).toBe("UAT");
  });

  it("requires strict boolean true for prodObservation", () => {
    expect(normalizeStoredProject({ prodObservation: true }).prodObservation).toBe(true);
    expect(normalizeStoredProject({ prodObservation: "true" }).prodObservation).toBe(false);
    expect(normalizeStoredProject({}).prodObservation).toBe(false);
  });

  it("handles null/invalid input", () => {
    const n = normalizeStoredProject(null);
    expect(n.certEnvs).toEqual(["uat"]);
    expect(n.env).toBe("UAT");
  });
});

describe("formatCertTiersShort", () => {
  it("formats STG+UAT when both tiers", () => {
    expect(formatCertTiersShort(["staging", "uat"])).toBe("STG+UAT");
  });

  it("returns empty for empty input", () => {
    expect(formatCertTiersShort([])).toBe("");
    expect(formatCertTiersShort(null)).toBe("");
  });
});
