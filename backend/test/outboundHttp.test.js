"use strict";

const { afterEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { postJsonWithTimeout } = require("../src/lib/outboundHttp");

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe("outbound JSON HTTP", () => {
  it("serializes JSON and preserves caller headers and redirect policy", async () => {
    let captured = null;
    const response = { ok: true, status: 204 };
    global.fetch = async (url, options) => {
      captured = { url, options };
      return response;
    };

    const result = await postJsonWithTimeout(
      "https://example.test/callback",
      { release_id: "rel_123" },
      {
        headers: { "User-Agent": "Verdikt-Test/1.0" },
        redirect: "error",
        timeoutMs: 100
      }
    );

    assert.equal(result, response);
    assert.equal(captured.url, "https://example.test/callback");
    assert.equal(captured.options.method, "POST");
    assert.equal(captured.options.headers["Content-Type"], "application/json");
    assert.equal(captured.options.headers["User-Agent"], "Verdikt-Test/1.0");
    assert.equal(captured.options.redirect, "error");
    assert.deepEqual(JSON.parse(captured.options.body), {
      release_id: "rel_123"
    });
    assert.ok(captured.options.signal instanceof AbortSignal);
  });

  it("returns non-2xx responses without retrying or hiding status evidence", async () => {
    let calls = 0;
    const response = { ok: false, status: 503 };
    global.fetch = async () => {
      calls += 1;
      return response;
    };

    const result = await postJsonWithTimeout(
      "https://example.test/webhook",
      "{}",
      { timeoutMs: 100 }
    );

    assert.equal(result, response);
    assert.equal(calls, 1);
  });

  it("aborts a hung request once without retrying the side effect", async () => {
    let calls = 0;
    global.fetch = (_url, options) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
        });
      });
    };

    await assert.rejects(
      () =>
        postJsonWithTimeout(
          "https://example.test/slow",
          { event: "verdikt.verdict" },
          { timeoutMs: 10 }
        ),
      /fetch timeout after 10ms/
    );
    assert.equal(calls, 1);
  });
});
