"use strict";

const { afterEach, describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  RESEND_TIMEOUT_MS,
  sendResendEmail
} = require("../src/services/email");

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

function request(overrides = {}) {
  return {
    apiKey: "re_test_key",
    from: "Verdikt <test@example.com>",
    to: ["person@example.com"],
    subject: "Test subject",
    text: "Test body",
    html: "<p>Test body</p>",
    ...overrides
  };
}

describe("Resend HTTP delivery", () => {
  it("uses the shared timeout path and preserves the request contract", async () => {
    let captured = null;
    global.fetch = async (url, options) => {
      captured = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: "email_123" })
      };
    };

    const result = await sendResendEmail(request());

    assert.deepEqual(result, { ok: true });
    assert.equal(captured.url, "https://api.resend.com/emails");
    assert.equal(captured.options.method, "POST");
    assert.equal(captured.options.headers.Authorization, "Bearer re_test_key");
    assert.ok(captured.options.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(captured.options.body), {
      from: "Verdikt <test@example.com>",
      to: ["person@example.com"],
      subject: "Test subject",
      text: "Test body",
      html: "<p>Test body</p>"
    });
  });

  it("returns the Resend error message for non-2xx responses", async () => {
    global.fetch = async () => ({
      ok: false,
      status: 422,
      json: async () => ({ message: "invalid recipient" })
    });

    const result = await sendResendEmail(request());

    assert.deepEqual(result, { ok: false, error: "invalid recipient" });
  });

  it("keeps the existing email timeout error contract", async () => {
    global.fetch = (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
        });
      });

    const result = await sendResendEmail(request(), { timeoutMs: 10 });

    assert.deepEqual(result, { ok: false, error: "email send timeout" });
    assert.equal(RESEND_TIMEOUT_MS, 15_000);
  });
});
