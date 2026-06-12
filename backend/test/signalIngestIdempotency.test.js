"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { extractIdempotencyKey } = require("../src/services/signalIngestIdempotency");

describe("signalIngestIdempotency", () => {
  it("prefers X-Idempotency-Key header over body and fallbacks", () => {
    const req = {
      headers: { "x-idempotency-key": " header-key " },
      body: { idempotency_key: "body-key" }
    };
    assert.equal(extractIdempotencyKey(req, ["delivery-1"]), "header-key");
  });

  it("uses body key when header is absent", () => {
    const req = { headers: {}, body: { idempotency_key: "body-key" } };
    assert.equal(extractIdempotencyKey(req, ["delivery-1"]), "body-key");
  });

  it("uses delivery fallback when header and body are absent", () => {
    const req = { headers: {}, body: {} };
    assert.equal(extractIdempotencyKey(req, [" delivery-2 "]), "delivery-2");
  });

  it("returns null when no key is provided", () => {
    assert.equal(extractIdempotencyKey({ headers: {}, body: {} }), null);
  });
});
