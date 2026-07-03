"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { fetchWithTimeout, DEFAULT_TIMEOUT_MS } = require("../src/lib/fetchWithTimeout");
const { ackGitHubWebhookFailure } = require("../src/lib/githubWebhookAck");

describe("fetchWithTimeout", () => {
  it("exports a default timeout constant", () => {
    assert.equal(DEFAULT_TIMEOUT_MS, 30_000);
  });

  it("aborts hung requests", async () => {
    const originalFetch = global.fetch;
    global.fetch = (_url, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () => {
          reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
        });
      });

    try {
      await assert.rejects(() => fetchWithTimeout("https://example.test/slow", {}, 20), /fetch timeout/);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

describe("ackGitHubWebhookFailure", () => {
  it("returns HTTP 200 with ok:false to prevent GitHub redelivery storms", () => {
    const body = {};
    const res = {
      status(code) {
        body.status = code;
        return this;
      },
      json(payload) {
        body.payload = payload;
        return this;
      }
    };
    ackGitHubWebhookFailure({ requestId: "test-req" }, res, new Error("boom"));
    assert.equal(body.status, 200);
    assert.equal(body.payload.ok, false);
    assert.equal(body.payload.error, "handler_failed");
  });
});
