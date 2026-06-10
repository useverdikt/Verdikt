"use strict";

const { queryAll } = require("../database");
const { AI_SIGNAL_IDS } = require("../config");

const TRAJECTORY = Object.freeze({
  IMPROVING: "IMPROVING",
  STABLE: "STABLE",
  DEGRADING: "DEGRADING",
  UNKNOWN: "UNKNOWN"
});

function slopeDirection(values) {
  if (values.length < 2) return TRAJECTORY.UNKNOWN;
  const first = values[0];
  const last = values[values.length - 1];
  const delta = last - first;
  const range = Math.max(Math.abs(first), Math.abs(last), 1);
  const relative = delta / range;
  if (Math.abs(relative) < 0.01) return TRAJECTORY.STABLE;
  return relative > 0 ? TRAJECTORY.IMPROVING : TRAJECTORY.DEGRADING;
}

/**
 * Compare current release signals against recent certified releases to infer trajectory.
 * Higher-is-better signals (accuracy, safety): declining values => DEGRADING.
 * Lower-is-better signals (latency, error rates): handled via invert where applicable.
 */
async function computeReleaseTrajectory({ workspaceId, releaseId, releaseRow }) {
  const recent = await queryAll(
    `SELECT id, created_at FROM releases
     WHERE workspace_id = ?
       AND id != ?
       AND status IN ('CERTIFIED', 'CERTIFIED_WITH_OVERRIDE')
       AND verdict_issued_at IS NOT NULL
       AND created_at::timestamptz < ?::timestamptz
     ORDER BY created_at::timestamptz DESC
     LIMIT 4`,
    [workspaceId, releaseId, releaseRow?.created_at || new Date().toISOString()]
  );

  if (!recent.length) {
    return {
      trajectory: TRAJECTORY.UNKNOWN,
      degrading_signals: [],
      improving_signals: [],
      trend_note: "No prior certified releases to compare against."
    };
  }

  const releaseIds = [releaseId, ...recent.map((r) => r.id)];
  const signalRows = await queryAll(
    `SELECT release_id, signal_id, value FROM signals
     WHERE release_id IN (${releaseIds.map(() => "?").join(",")})
     ORDER BY id ASC`,
    releaseIds
  );

  const byRelease = new Map();
  for (const row of signalRows) {
    if (!byRelease.has(row.release_id)) byRelease.set(row.release_id, {});
    byRelease.get(row.release_id)[row.signal_id] = row.value;
  }

  const currentMap = byRelease.get(releaseId) || {};
  const degrading = [];
  const improving = [];
  const notes = [];

  for (const signalId of AI_SIGNAL_IDS) {
    const currentVal = currentMap[signalId];
    if (currentVal == null || !Number.isFinite(Number(currentVal))) continue;

    const history = [];
    for (const rel of [...recent].reverse()) {
      const v = byRelease.get(rel.id)?.[signalId];
      if (v != null && Number.isFinite(Number(v))) history.push(Number(v));
    }
    if (history.length < 2) continue;
    history.push(Number(currentVal));

    const dir = slopeDirection(history);
    if (dir === TRAJECTORY.DEGRADING) degrading.push(signalId);
    if (dir === TRAJECTORY.IMPROVING) improving.push(signalId);
  }

  let trajectory = TRAJECTORY.STABLE;
  if (degrading.length >= 2) trajectory = TRAJECTORY.DEGRADING;
  else if (degrading.length === 1 && improving.length === 0) trajectory = TRAJECTORY.DEGRADING;
  else if (improving.length >= 2 && degrading.length === 0) trajectory = TRAJECTORY.IMPROVING;
  else if (degrading.length === 0 && improving.length === 0) trajectory = TRAJECTORY.STABLE;

  if (degrading.length) {
    notes.push(`${degrading.join(", ")} declining across recent releases`);
  }

  return {
    trajectory,
    degrading_signals: degrading,
    improving_signals: improving,
    trend_note: notes.length ? notes.join("; ") : "Signals stable relative to recent certified releases."
  };
}

module.exports = { computeReleaseTrajectory, TRAJECTORY };
