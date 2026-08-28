"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { csvCell, formatAuditExportCsv } = require("../src/services/auditExport");

describe("audit export formatting", () => {
  it("quotes commas and quotes in CSV cells", () => {
    assert.equal(csvCell("a,b"), '"a,b"');
    assert.equal(csvCell('say "hi"'), '"say ""hi"""');
    assert.equal(csvCell(null), "");
  });

  it("includes hash-chain columns", () => {
    const csv = formatAuditExportCsv([
      {
        id: 1,
        created_at: "2026-08-28T00:00:00.000Z",
        event_type: "OVERRIDE_APPROVED",
        actor_type: "USER",
        actor_name: "ada@example.com",
        release_id: "rel_1",
        agent_session_id: "sess_1",
        prev_hash: "GENESIS",
        row_hash: "abc123",
        details_json: "{\"ok\":true}"
      }
    ]);
    assert.match(csv, /prev_hash,row_hash,details_json/);
    assert.match(csv, /GENESIS/);
    assert.match(csv, /abc123/);
    assert.match(csv, /sess_1/);
  });
});
