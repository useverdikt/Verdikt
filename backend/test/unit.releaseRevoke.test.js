"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { validateRevokeJustification } = require("../src/services/releaseRevoke");

describe("revoke justification", () => {
  it("requires at least 8 characters", () => {
    assert.equal(validateRevokeJustification("short").ok, false);
    assert.equal(validateRevokeJustification("  enough text  ").ok, true);
    assert.equal(validateRevokeJustification("  enough text  ").justification, "enough text");
  });
});
