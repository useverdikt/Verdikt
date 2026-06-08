"use strict";

const { run } = require("../database");
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
async function extendCollectionDeadline(release, extendMinutes = DEFAULT_COLLECTION_WINDOW_MINUTES) {
  if (!release || release.status !== "COLLECTING") {
    const err = new Error("release must be in COLLECTING status to extend the collection deadline");
    err.status = 409;
    throw err;
  }

  const mins = Math.min(
    MAX_EXTEND_MINUTES,
    Math.max(1, Math.floor(Number(extendMinutes) || DEFAULT_COLLECTION_WINDOW_MINUTES))
  );
  const nowMs = Date.now();
  const currentEndMs = release.collection_deadline ? Date.parse(release.collection_deadline) : nowMs;
  const baseMs = Math.max(Number.isFinite(currentEndMs) ? currentEndMs : nowMs, nowMs);
  const capMs = nowMs + MAX_HORIZON_HOURS * 60 * 60_000;
  const newEndMs = Math.min(baseMs + mins * 60_000, capMs);
  const newDeadline = new Date(newEndMs).toISOString();
  const previousDeadline = release.collection_deadline || null;

  await run("UPDATE releases SET collection_deadline = ?, updated_at = ? WHERE id = ?", [
    newDeadline,
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
      previous_deadline: previousDeadline,
      collection_deadline: newDeadline,
      extend_minutes: mins
    }
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
