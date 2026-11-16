"use strict";

const { queryAll, transaction } = require("../database");
const { releaseVerdictLockedAgainstIngest } = require("./verdictEngine");

/**
 * Delete a source's signals (for example a CSV import being replaced or removed)
 * from releases that still accept ingest. Releases whose verdict is locked keep
 * them, because those rows are the evidence the verdict was issued on.
 */
async function deleteSourceSignalsForUnlockedReleases(source) {
  const rows = await queryAll("SELECT DISTINCT release_id FROM signals WHERE source = $1", [source]);
  const kept = [];
  for (const { release_id: releaseId } of rows) {
    await transaction(async (tx) => {
      const release = await tx.queryOne(
        "SELECT status, environment, verdict_issued_at FROM releases WHERE id = $1 FOR SHARE",
        [releaseId]
      );
      if (releaseVerdictLockedAgainstIngest(release)) {
        kept.push(releaseId);
        return;
      }
      await tx.run("DELETE FROM signals WHERE release_id = $1 AND source = $2", [releaseId, source]);
    });
  }
  return { kept_locked_release_ids: kept };
}

module.exports = { deleteSourceSignalsForUnlockedReleases };
