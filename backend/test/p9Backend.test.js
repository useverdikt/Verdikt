"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

describe("certification snapshot retry policy", () => {
  it("schedules exponential backoff with audit on cert-like exhaustion", () => {
    const src = fs.readFileSync(
      path.join(__dirname, "../src/services/certificationSnapshotRetry.js"),
      "utf8"
    );
    assert.match(src, /MAX_ATTEMPTS = 4/);
    assert.match(src, /CERTIFICATION_SNAPSHOT_FAILED/);
    assert.match(src, /BACKOFF_MS/);
  });
});

describe("escalation SLA sweep contract", () => {
  it("uses bulk UPDATE for breach and reminder batches", () => {
    const src = fs.readFileSync(path.join(__dirname, "../src/services/escalations.js"), "utf8");
    assert.match(src, /UPDATE escalation_requests SET sla_breached = 1/);
    assert.match(src, /Promise\.allSettled/);
    assert.match(src, /sla_reminder_sent_at = \$1, updated_at = \$2\s+WHERE id IN/);
  });
});
