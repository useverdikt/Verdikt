import { describe, expect, it } from "vitest";
import { formatOutcomeDrivers } from "./alignmentTableCopy.js";

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
