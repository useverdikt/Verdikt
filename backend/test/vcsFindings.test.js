"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  classifyPullRequest,
  classifyCommitMessage,
  findingsToSignals,
  deriveInferredOutcome,
  shouldIngestSignals
} = require("../src/services/vcsFindings");

describe("vcsFindings integrity-first", () => {
  const sinceMs = Date.parse("2026-06-18T18:00:00.000Z");
  const untilMs = Date.parse("2026-06-18T20:00:00.000Z");

  it("counts merged incident-labelled PR as confirmed incident", () => {
    const hit = classifyPullRequest(
      {
        number: 172,
        title: "dogfood incident",
        labels: [{ name: "incident" }],
        state: "closed",
        created_at: "2026-06-18T18:30:00.000Z",
        merged_at: "2026-06-18T18:45:00.000Z"
      },
      { sinceMs, untilMs }
    );
    assert.equal(hit.bucket, "incident_prs_merged");
  });

  it("open incident PR is investigating only", () => {
    const hit = classifyPullRequest(
      {
        number: 172,
        title: "dogfood incident",
        labels: [{ name: "incident" }],
        state: "open",
        created_at: "2026-06-18T18:30:00.000Z",
        merged_at: null
      },
      { sinceMs, untilMs }
    );
    assert.equal(hit.bucket, "investigating_prs");
  });

  it("closed unmerged incident PR is ignored", () => {
    const hit = classifyPullRequest(
      {
        number: 172,
        title: "dogfood incident",
        labels: [{ name: "incident" }],
        state: "closed",
        created_at: "2026-06-18T18:30:00.000Z",
        merged_at: null
      },
      { sinceMs, untilMs }
    );
    assert.equal(hit, null);
  });

  it("PR opened before window is ignored", () => {
    const hit = classifyPullRequest(
      {
        number: 99,
        title: "old",
        labels: [{ name: "incident" }],
        state: "open",
        created_at: "2026-06-18T12:00:00.000Z",
        merged_at: null
      },
      { sinceMs, untilMs }
    );
    assert.equal(hit, null);
  });

  it("hotfix commit on main is confirmed", () => {
    const hit = classifyCommitMessage("hotfix: patch auth", "abc123", "deploy_sha");
    assert.equal(hit.kind, "hotfix");
  });

  it("investigating-only yields INVESTIGATING outcome not INCIDENT", () => {
    const signals = findingsToSignals({
      revert_commits: [],
      hotfix_commits: [],
      incident_prs_merged: [],
      investigating_prs: [{ number: 1 }]
    });
    assert.equal(deriveInferredOutcome(signals, false), "INVESTIGATING");
    assert.equal(shouldIngestSignals(signals, false), true);
  });

  it("merged incident PR yields INCIDENT outcome", () => {
    const signals = findingsToSignals({
      revert_commits: [],
      hotfix_commits: [],
      incident_prs_merged: [{ number: 1 }],
      investigating_prs: []
    });
    assert.equal(deriveInferredOutcome(signals, false), "INCIDENT");
  });
});
