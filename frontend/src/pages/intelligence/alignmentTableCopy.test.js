import { describe, expect, it } from "vitest";
import {
  formatOutcomeDrivers,
  formatPreShipRecommendation,
  resolveAlignmentDisplay
} from "./alignmentTableCopy.js";

describe("formatOutcomeDrivers", () => {
  it("shows breached criteria when outcome rules fired", () => {
    const out = formatOutcomeDrivers({
      outcome_criteria: [{ label: "Error rate > 5%", value: 6.2, outcome: "INCIDENT" }],
      actual_outcome: "INCIDENT",
      signal_deltas: {}
    });
    expect(out.text).toBe("Error rate > 5%: 6.2");
    expect(out.expandable).toBe(true);
  });

  it("shows clean VCS window when vcs_healthy observed with no findings", () => {
    const out = formatOutcomeDrivers({
      outcome_criteria: [],
      actual_outcome: "HEALTHY",
      signal_deltas: {
        vcs_healthy: { post: 1 },
        vcs_reverts: { post: 0 },
        vcs_hotfixes: { post: 0 },
        vcs_incident_prs: { post: 0 }
      }
    });
    expect(out.text).toBe("Clean monitoring window — no reverts/hotfixes");
    expect(out.expandable).toBe(true);
  });

  it("shows generic healthy copy when no VCS marker present", () => {
    const out = formatOutcomeDrivers({
      outcome_criteria: [],
      actual_outcome: "HEALTHY",
      signal_deltas: { accuracy: { post: 91 } }
    });
    expect(out.text).toBe("No incident criteria met");
  });
});

describe("formatPreShipRecommendation", () => {
  it("uses human labels instead of status vocabulary", () => {
    expect(formatPreShipRecommendation("UNCERTIFIED").label).toBe("Do not ship");
    expect(formatPreShipRecommendation("CERTIFIED_WITH_RISK").label).toBe("Cautious proceed");
    expect(formatPreShipRecommendation("CERTIFIED_WITH_RISK").riskIndicator).toBe(true);
    expect(formatPreShipRecommendation("CERTIFIED").label).toBe("Low risk");
  });

  it("includes frozen release facts in the tooltip", () => {
    const meta = formatPreShipRecommendation("UNCERTIFIED", {
      release_status: "UNCERTIFIED",
      shipped_without_certification: true,
      environment: "prod"
    });
    expect(meta.title).toContain("Release status: UNCERTIFIED");
    expect(meta.title).toContain("Bypassed at merge");
    expect(meta.title).toContain("Environment: prod");
  });
});

describe("resolveAlignmentDisplay", () => {
  it("distinguishes bypass merges from true over-blocks", () => {
    const bypass = resolveAlignmentDisplay("OVER_BLOCK", { shipped_without_certification: true });
    expect(bypass.label).toBe("Bypass · healthy");
    expect(bypass.label).not.toBe("Over-block");

    const overBlock = resolveAlignmentDisplay("OVER_BLOCK", { shipped_without_certification: false });
    expect(overBlock.label).toBe("Over-block");
  });
});
