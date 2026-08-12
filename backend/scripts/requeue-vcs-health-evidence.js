"use strict";

const {
  listTaintedVcsHealthEvidence,
  requeueTaintedVcsHealthEvidence
} = require("../src/services/vcsMonitoringRepair");
const { closePool } = require("../src/database");

function readArg(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}

async function main() {
  const workspaceId = readArg("workspace-id");
  const since = readArg("since");
  const execute = process.argv.includes("--execute");
  if (!workspaceId) {
    throw new Error("--workspace-id is required");
  }

  if (!execute) {
    const releaseIds = await listTaintedVcsHealthEvidence(workspaceId, { since });
    console.log(
      JSON.stringify({
        mode: "dry_run",
        workspace_id: workspaceId,
        since: since || null,
        windows_to_requeue: releaseIds.length
      })
    );
    return;
  }

  const result = await requeueTaintedVcsHealthEvidence(workspaceId, {
    since,
    actorName: "operator_requeue_vcs_health_evidence"
  });
  console.log(JSON.stringify({ mode: "execute", ...result }));
}

main()
  .catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 1;
  })
  .finally(() => closePool());
