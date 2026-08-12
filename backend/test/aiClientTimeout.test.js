"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { withTimeoutRetry } = require("../src/services/aiClient");

describe("AI request timeout retries", () => {
  it("aborts a timed-out attempt before starting its retry", async () => {
    const signals = [];
    let active = 0;
    let maxActive = 0;

    const task = ({ signal }) =>
      new Promise((_resolve, reject) => {
        signals.push(signal);
        active += 1;
        maxActive = Math.max(maxActive, active);
        signal.addEventListener(
          "abort",
          () => {
            active -= 1;
            reject(Object.assign(new Error("provider request aborted"), {
              name: "AbortError"
            }));
          },
          { once: true }
        );
      });

    await assert.rejects(
      () => withTimeoutRetry(task, { timeoutMs: 10, retries: 1 }),
      /ai_call_timeout/
    );

    assert.equal(signals.length, 2);
    assert.equal(maxActive, 1);
    assert.equal(active, 0);
    assert.ok(signals.every((signal) => signal.aborted));
  });

  it("clears the attempt timer after a successful call", async () => {
    let signal;
    const result = await withTimeoutRetry(
      ({ signal: attemptSignal }) => {
        signal = attemptSignal;
        return Promise.resolve("ok");
      },
      { timeoutMs: 10, retries: 1 }
    );

    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(result, "ok");
    assert.equal(signal.aborted, false);
  });

  it("does not retry non-timeout provider errors", async () => {
    let attempts = 0;

    await assert.rejects(
      () =>
        withTimeoutRetry(
          () => {
            attempts += 1;
            throw new Error("ai_call_http_401");
          },
          { timeoutMs: 10, retries: 3 }
        ),
      /ai_call_http_401/
    );

    assert.equal(attempts, 1);
  });
});
