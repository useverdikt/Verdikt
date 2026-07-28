"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  logicalSlug,
  checkMigrationParity,
  SUPABASE_ONLY_SLUGS
} = require("../../scripts/check-migration-parity.js");
const {
  CERT_LIKE,
  VERDICTED,
  BLOCKED_OR_COLLECTING,
  isVerdictedStatus,
  isBlockedOrCollectingStatus
} = require("@useverdikt/shared/releaseStatus");

describe("migration parity script", () => {
  it("extracts logical slugs from backend and supabase filenames", () => {
    assert.equal(logicalSlug("033_alignment_over_block_to_cautious.sql"), "alignment_over_block_to_cautious");
    assert.equal(
      logicalSlug("20260625000003_alignment_over_block_to_cautious.sql"),
      "alignment_over_block_to_cautious"
    );
  });

  it("passes when paired supabase migrations exist on backend track", () => {
    const summary = checkMigrationParity();
    assert.ok(summary.backend_count >= summary.paired_count);
    assert.ok(summary.supabase_only_count >= SUPABASE_ONLY_SLUGS.size - 1);
  });
});

describe("shared release status sets", () => {
  it("exports verdicted and blocked/collecting helpers", () => {
    assert.equal(isVerdictedStatus("CERTIFIED"), true);
    assert.equal(isVerdictedStatus("COLLECTING"), false);
    assert.equal(isBlockedOrCollectingStatus("COLLECTING"), true);
    assert.equal(CERT_LIKE.has("CERTIFIED"), true);
    assert.equal(VERDICTED.has("UNCERTIFIED"), true);
    assert.equal(BLOCKED_OR_COLLECTING.has("UNCERTIFIED"), true);
  });
});
