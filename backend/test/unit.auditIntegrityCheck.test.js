"use strict";

process.env.NODE_ENV = "test";

const { describe, it, mock, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const opsAlert = require("../src/lib/opsAlert");
const { reportAuditIntegrity, integrityIssueCount } = require("../src/jobs/auditIntegrityCheck");

describe("audit integrity reporting", () => {
  afterEach(() => {
    mock.restoreAll();
  });

  it("counts issues and does not alert when the chain is valid", async () => {
    const notify = mock.method(opsAlert, "notifyOps", async () => ({ ok: true }));
    const result = { valid: true, total: 3, ok: 3, tampered: [], broken_chain: [], missing_hash: [] };
    assert.equal(integrityIssueCount(result), 0);
    await reportAuditIntegrity(result);
    assert.equal(notify.mock.callCount(), 0);
  });

  it("alerts on a broken chain", async () => {
    const notify = mock.method(opsAlert, "notifyOps", async () => ({ skipped: true, reason: "test" }));
    const result = {
      valid: false,
      total: 2,
      ok: 1,
      tampered: [{ id: 9 }],
      broken_chain: [],
      missing_hash: []
    };
    await reportAuditIntegrity(result, { notify: true, workspaceId: "ws_1" });
    assert.equal(notify.mock.callCount(), 1);
    assert.equal(notify.mock.calls[0].arguments[0].event, "audit_integrity_failed");
  });
});
