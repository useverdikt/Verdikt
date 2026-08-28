"use strict";

const { verifyAuditIntegrity } = require("../services/auditIntegrity");
const opsAlert = require("../lib/opsAlert");
const { log } = require("../lib/observability");

function integrityIssueCount(result) {
  return (
    (result?.tampered?.length || 0) +
    (result?.broken_chain?.length || 0) +
    (result?.missing_hash?.length || 0)
  );
}

function sampleIssueIds(result, limit = 8) {
  const rows = [
    ...(result?.tampered || []),
    ...(result?.broken_chain || []),
    ...(result?.missing_hash || [])
  ];
  return rows.slice(0, limit).map((r) => r.id);
}

async function reportAuditIntegrity(result, { notify = true, workspaceId = null } = {}) {
  const issueCount = integrityIssueCount(result);
  if (result?.valid) {
    log("info", "audit_integrity_ok", {
      workspaceId: workspaceId || "all",
      total: result.total,
      ok: result.ok
    });
    return result;
  }
  const fields = {
    workspaceId: workspaceId || "all",
    total: result?.total || 0,
    issueCount,
    tamperedCount: result?.tampered?.length || 0,
    brokenChainCount: result?.broken_chain?.length || 0,
    missingHashCount: result?.missing_hash?.length || 0,
    sampleIds: sampleIssueIds(result)
  };
  if (notify) {
    await opsAlert.notifyOps({
      event: "audit_integrity_failed",
      subject: "Verdikt: audit chain integrity FAILED",
      text: [
        "verifyAuditIntegrity reported a broken or tampered audit chain.",
        `Workspace: ${workspaceId || "all"}`,
        `Total rows: ${fields.total}`,
        `Tampered: ${fields.tamperedCount}`,
        `Broken chain: ${fields.brokenChainCount}`,
        `Missing hash: ${fields.missingHashCount}`,
        `Sample ids: ${fields.sampleIds.join(", ") || "none"}`
      ].join("\n"),
      fields
    });
  } else {
    log("error", "audit_integrity_failed", fields);
  }
  return result;
}

async function runAuditIntegrityCheck({ workspaceId = null, notify = true } = {}) {
  const result = await verifyAuditIntegrity(workspaceId);
  await reportAuditIntegrity(result, { notify, workspaceId });
  return result;
}

function startAuditIntegrityCheckJob() {
  if (process.env.NODE_ENV === "test" && process.env.AUDIT_INTEGRITY_CHECK_MS == null) return null;
  const intervalMs = Number(process.env.AUDIT_INTEGRITY_CHECK_MS ?? 24 * 60 * 60 * 1000);
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return null;
  const initialDelayMs = Math.max(5_000, Number(process.env.AUDIT_INTEGRITY_CHECK_INITIAL_DELAY_MS || 60_000));
  const run = () => {
    void runAuditIntegrityCheck().catch((err) => {
      log("error", "audit_integrity_check_unhandled", { error: String(err?.message || err).slice(0, 500) });
    });
  };
  const timeout = setTimeout(run, initialDelayMs);
  const interval = setInterval(run, intervalMs);
  if (typeof timeout.unref === "function") timeout.unref();
  if (typeof interval.unref === "function") interval.unref();
  return { timeout, interval };
}

function stopAuditIntegrityCheckJob(handle) {
  if (!handle) return;
  if (handle.timeout) clearTimeout(handle.timeout);
  if (handle.interval) clearInterval(handle.interval);
}

module.exports = {
  integrityIssueCount,
  reportAuditIntegrity,
  runAuditIntegrityCheck,
  startAuditIntegrityCheckJob,
  stopAuditIntegrityCheckJob
};
