"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { safeJsonParse } = require("../src/lib/safeJson");

describe("safeJsonParse", () => {
  it("returns fallback on invalid JSON", () => {
    assert.deepEqual(safeJsonParse("{bad", []), []);
    assert.deepEqual(safeJsonParse(null, {}), {});
  });

  it("parses valid JSON", () => {
    assert.deepEqual(safeJsonParse('["a"]', []), ["a"]);
  });
});
