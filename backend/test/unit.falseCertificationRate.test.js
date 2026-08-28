"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { computeFalseCertificationRatePct } = require("../src/services/productionFeedback");

describe("false-certification rate", () => {
  it("is misses over scored alignments, excluding UNKNOWN", () => {
    assert.equal(computeFalseCertificationRatePct(1, 4), 25);
    assert.equal(computeFalseCertificationRatePct(0, 10), 0);
    assert.equal(computeFalseCertificationRatePct(2, 3), 67);
  });

  it("is null when nothing has been scored", () => {
    assert.equal(computeFalseCertificationRatePct(0, 0), null);
    assert.equal(computeFalseCertificationRatePct(1, 0), null);
  });
});
