"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { classifyGithubReleaseType } = require("../src/services/githubReleaseClassification");

describe("classifyGithubReleaseType", () => {
  it("classifies incident label as incident_hotfix", () => {
    assert.equal(
      classifyGithubReleaseType({
        pull_request: { title: "Fix login", labels: [{ name: "incident" }] }
      }),
      "incident_hotfix"
    );
  });

  it("classifies p0 in title as incident_hotfix", () => {
    assert.equal(
      classifyGithubReleaseType({ pull_request: { title: "P0 outage fix", labels: [] } }),
      "incident_hotfix"
    );
  });

  it("does not classify bare revert/rollback title as incident_hotfix", () => {
    assert.equal(
      classifyGithubReleaseType({ pull_request: { title: "Revert bad deploy", labels: [] } }),
      "model_update"
    );
    assert.equal(
      classifyGithubReleaseType({ pull_request: { title: "Rollback feature flag", labels: [] } }),
      "model_update"
    );
  });

  it("classifies hotfix label as incident_hotfix", () => {
    assert.equal(
      classifyGithubReleaseType({
        pull_request: { title: "Patch", labels: [{ name: "hotfix" }] }
      }),
      "incident_hotfix"
    );
  });
});
