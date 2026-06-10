"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  humanizePullError,
  buildIntegrationPullWarnings,
  summarizePullResult
} = require("../src/services/integrationPullStatus");

describe("integrationPullStatus", () => {
  it("humanizes braintrust SHA mismatch with commit hint", () => {
    const msg = humanizePullError("braintrust", "no_experiment_for_version", {
      commit_sha: "abc123def456"
    });
    assert.match(msg, /Braintrust/);
    assert.match(msg, /git_sha|commit SHA/i);
    assert.match(msg, /abc123def456/i);
  });

  it("builds warnings for failed pulls", () => {
    const warnings = buildIntegrationPullWarnings(
      {
        sources: {
          braintrust: { ok: false, error: "no_experiment_for_version" },
          sentry: { ok: true }
        }
      },
      { commit_sha: "deadbeef" }
    );
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].source, "braintrust");
    assert.match(warnings[0].message, /Braintrust/);
  });

  it("summarizePullResult includes results map", () => {
    const summary = summarizePullResult(
      {
        ok: true,
        sources: { browserstack: { ok: false, error: "no_build_for_version" } }
      },
      { commit_sha: "sha1", pr_number: 12 }
    );
    assert.equal(summary.commit_sha, "sha1");
    assert.equal(summary.results.browserstack.ok, false);
    assert.ok(summary.warnings.length >= 1);
  });
});
