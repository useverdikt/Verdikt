"use strict";

const { writeAudit } = require("./audit");
const { pullConnectedSourcesForRelease } = require("./signalIngestFromSources");

/**
 * Pull connected integrations for a release opened by GitHub label trigger.
 * Errors are logged; never thrown to callers (webhook must stay fast).
 */
async function runIntegrationPullForRelease(releaseRow, { requestId = null, trigger = "github_label" } = {}) {
  if (!releaseRow?.id) return { skipped: true, reason: "missing_release" };

  const out = await pullConnectedSourcesForRelease(releaseRow);

  await writeAudit({
    workspaceId: releaseRow.workspace_id,
    releaseId: releaseRow.id,
    eventType: "SIGNAL_SOURCES_PULL",
    actorType: "SYSTEM",
    actorName: "github_label_trigger",
    details: {
      trigger,
      ok: out.ok,
      sources: out.sources ? Object.keys(out.sources) : [],
      request_id: requestId || null,
      async: true
    }
  });

  if (requestId) {
    console.log(`[${requestId}] github label integration pull`, {
      release_id: releaseRow.id,
      ok: out.ok,
      sources: out.sources ? Object.keys(out.sources) : []
    });
  }

  return out;
}

/** Fire-and-forget integration pull after label webhook opens or reuses a cert window. */
function scheduleIntegrationPullForRelease(releaseRow, meta = {}) {
  if (!releaseRow?.id) return;
  setImmediate(() => {
    void runIntegrationPullForRelease(releaseRow, meta).catch((err) => {
      const rid = meta.requestId ? `[${meta.requestId}] ` : "";
      console.error(`${rid}github label integration pull failed:`, err?.message || err);
    });
  });
}

module.exports = {
  scheduleIntegrationPullForRelease,
  runIntegrationPullForRelease
};
