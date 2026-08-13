"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { pickReleaseForIngestFromList, commitShaMatches } = require("../src/lib/releaseIngestPick");

describe("pickReleaseForIngestFromList", () => {
  const releases = [
    {
      id: "rel_old",
      workspace_id: "ws_1",
      version: "v1.0.0",
      commit_sha: "abc1234567890",
      status: "CERTIFIED",
      created_at: "2026-01-01T00:00:00.000Z"
    },
    {
      id: "rel_collecting",
      workspace_id: "ws_1",
      version: "v1.1.0",
      commit_sha: "def9876543210",
      status: "COLLECTING",
      created_at: "2026-02-01T00:00:00.000Z"
    },
    {
      id: "rel_new_cert",
      workspace_id: "ws_1",
      version: "v1.0.0",
      commit_sha: "abc1234567890",
      pr_number: 42,
      status: "UNCERTIFIED",
      created_at: "2026-03-01T00:00:00.000Z"
    }
  ];

  it("prefers newest release when multiple share a commit prefix", () => {
    const picked = pickReleaseForIngestFromList(releases, { commit_sha: "abc1234" });
    assert.equal(picked.id, "rel_new_cert");
  });

  it("prefers COLLECTING when commit sha matches", () => {
    const picked = pickReleaseForIngestFromList(releases, { commit_sha: "def9876543210" });
    assert.equal(picked.id, "rel_collecting");
  });

  it("resolves by version without extra queries", () => {
    const picked = pickReleaseForIngestFromList(releases, { version: "v1.1.0" });
    assert.equal(picked.id, "rel_collecting");
  });

  it("returns null when no identity matches", () => {
    assert.equal(pickReleaseForIngestFromList(releases, { version: "missing" }), null);
  });

  it("does not fall back to PR/version when a supplied SHA misses", () => {
    const picked = pickReleaseForIngestFromList(releases, {
      commit_sha: "ffffffffffffffff",
      pr_number: 42,
      version: "v1.0.0"
    });
    assert.equal(picked, null);
  });

  it("commitShaMatches accepts short sha prefixes", () => {
    assert.equal(commitShaMatches("abc1234567890", "abc1234"), true);
  });
});
