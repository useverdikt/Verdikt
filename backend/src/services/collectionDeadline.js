"use strict";

const { transaction } = require("../database");
const { nowIso } = require("../lib/time");
const { writeAudit } = require("./audit");
const { broadcastToRelease } = require("./sseManager");
const { DEFAULT_COLLECTION_WINDOW_MINUTES } = require("../config");

const MAX_EXTEND_MINUTES = 120;
const MAX_HORIZON_HOURS = 24;

/**
 * Extend the server-side collection window for a COLLECTING release.
 * @param {object} release – row from requireReleaseAccess
 * @param {number} [extendMinutes] – minutes to add (default: workspace collection window)
 */
function notCollectingError() {
  const err = new Error("release must be in COLLECTING status to extend the collection deadline");
  err.status = 409;
  return err;
}

async function extendCollectionDeadline(release, extendMinutes = DEFAULT_COLLECTION_WINDOW_MINUTES) {
  if (!release || release.status !== "COLLECTING") throw notCollectingError();

  const mins = Math.min(
    MAX_EXTEND_MINUTES,
    Math.max(1, Math.floor(Number(extendMinutes) || DEFAULT_COLLECTION_WINDOW_MINUTES))
  );

  const { newDeadline, previousDeadline } = await transaction(async (tx) => {
    const locked = await tx.queryOne(
      "SELECT status, collection_deadline FROM releases WHERE id = $1 FOR UPDATE",
      [release.id]
    );
    if (!locked || locked.status !== "COLLECTING") throw notCollectingError();

    const nowMs = Date.now();
    const currentEndMs = locked.collection_deadline ? Date.parse(locked.collection_deadline) : nowMs;
    const baseMs = Math.max(Number.isFinite(currentEndMs) ? currentEndMs : nowMs, nowMs);
    const capMs = nowMs + MAX_HORIZON_HOURS * 60 * 60_000;
    const extended = new Date(Math.min(baseMs + mins * 60_000, capMs)).toISOString();
    const previous = locked.collection_deadline || null;

    await tx.run("UPDATE releases SET collection_deadline = $1, updated_at = $2 WHERE id = $3", [
      extended,
      nowIso(),
      release.id
    ]);
    await writeAudit({
      workspaceId: release.workspace_id,
      releaseId: release.id,
      eventType: "COLLECTION_DEADLINE_EXTENDED",
      actorType: "USER",
      actorName: "release_owner",
      details: {
        previous_deadline: previous,
        collection_deadline: extended,
        extend_minutes: mins
      },
      tx
    });
    return { newDeadline: extended, previousDeadline: previous };
  });

  broadcastToRelease(release.id, "deadline_extended", {
    release_id: release.id,
    collection_deadline: newDeadline,
    extend_minutes: mins,
    ts: nowIso()
  });

  return {
    collection_deadline: newDeadline,
    extend_minutes: mins,
    previous_deadline: previousDeadline
  };
}

module.exports = { extendCollectionDeadline, MAX_EXTEND_MINUTES, MAX_HORIZON_HOURS };
