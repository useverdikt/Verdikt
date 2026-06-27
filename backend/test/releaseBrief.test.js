"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  mapSuggestedVerb,
  summarizeTopBlockers,
  buildRegressionStory,
  buildHubLinks
} = require("../src/services/releaseBrief");

describe("releaseBrief helpers", () => {
  it("mapSuggestedVerb maps gate actions to agent verbs", () => {
    assert.equal(mapSuggestedVerb("merge"), "merge");
    assert.equal(mapSuggestedVerb("escalate"), "escalate");
    assert.equal(mapSuggestedVerb("collecting"), "poll");
    assert.equal(mapSuggestedVerb("self_heal"), "poll");
    assert.equal(mapSuggestedVerb("recover_certification"), "poll");
  });

  it("summarizeTopBlockers caps at three entries", () => {
    const blockers = Array.from({ length: 5 }, (_, i) => ({
      type: "threshold_failed",
      signal_id: `sig_${i}`,
      message: `fail ${i}`,
      next_step: `fix ${i}`
    }));
    const out = summarizeTopBlockers(blockers, 3);
    assert.equal(out.length, 3);
    assert.equal(out[0].signal_id, "sig_0");
  });

  it("buildRegressionStory surfaces baseline skip message", () => {
    const out = buildRegressionStory({
      regression_context: { no_prior_certified_baseline: true },
      failures: []
    });
    assert.equal(out.has_regression, false);
    assert.match(out.summary, /no prior certified baseline/i);
  });

  it("buildRegressionStory detects regression failures", () => {
    const out = buildRegressionStory({
      failures: [
        {
          signal_id: "accuracy",
          failure_kind: "regression",
          regression_streak: { consecutive_releases: 2 }
        }
      ],
      last_passing_baseline: { version: "v1.0.0" },
      regression_context: { baseline_release_id: "rel_old" }
    });
    assert.equal(out.has_regression, true);
    assert.match(out.summary, /accuracy/i);
    assert.match(out.summary, /v1\.0\.0/);
  });

  it("buildHubLinks includes intelligence routes", () => {
    const links = buildHubLinks({ workspaceId: "ws_test" });
    assert.match(links.intelligence_alignment, /\/intelligence\/alignment$/);
    assert.equal(links.workspace_id, "ws_test");
  });
});
