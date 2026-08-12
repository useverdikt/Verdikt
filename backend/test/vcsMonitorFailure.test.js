"use strict";

process.env.NODE_ENV = "test";
process.env.JWT_SECRET = "test-jwt-secret-32-chars-minimum!!";
process.env.WEBHOOK_SECRET = "test-webhook-secret-24-char-min";

const { afterEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  VcsProviderError,
  scanGitHub
} = require("../src/services/vcsMonitor");

const originalFetch = global.fetch;
const cfg = {
  owner: "useverdikt",
  repo: "Verdikt",
  access_token: "not-a-real-token"
};
const since = "2026-08-12T10:00:00.000Z";
const until = "2026-08-12T12:00:00.000Z";

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

afterEach(() => {
  global.fetch = originalFetch;
});

describe("VCS monitor provider failures", () => {
  it("fails closed when GitHub rejects the configured credential", async () => {
    global.fetch = async () => response(401, { message: "Bad credentials" });

    await assert.rejects(
      () => scanGitHub(cfg, "abc123", 267, since, until),
      (error) => {
        assert.ok(error instanceof VcsProviderError);
        assert.equal(error.provider, "GitHub");
        assert.equal(error.status, 401);
        return true;
      }
    );
  });

  it("does not infer empty findings when a required scan request fails", async () => {
    let call = 0;
    global.fetch = async () => {
      call += 1;
      if (call === 1) return response(200, { default_branch: "main" });
      if (call === 2) return response(200, { base: { ref: "main" } });
      return response(503, { message: "temporarily unavailable" });
    };

    await assert.rejects(
      () => scanGitHub(cfg, "abc123", 267, since, until),
      (error) => error instanceof VcsProviderError && error.status === 503
    );
  });

  it("returns empty findings only after every required GitHub read succeeds", async () => {
    global.fetch = async (url) => {
      if (url.endsWith("/repos/useverdikt/Verdikt")) {
        return response(200, { default_branch: "main" });
      }
      if (url.includes("/pulls/267")) {
        return response(200, { base: { ref: "main" } });
      }
      return response(200, []);
    };

    const findings = await scanGitHub(cfg, "abc123", 267, since, until);
    assert.deepEqual(findings, {
      revert_commits: [],
      hotfix_commits: [],
      incident_prs_merged: [],
      investigating_prs: []
    });
  });
});
