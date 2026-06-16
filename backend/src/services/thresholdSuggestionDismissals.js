"use strict";

/**
 * Persisted threshold suggestion dismissals — stable by signal + direction (+ source).
 * Supplements audit_events so dismissed suggestions do not reappear on new alignments.
 */

const { queryAll, run } = require("../database");
const { nowIso } = require("../lib/time");

function dismissKey(signalId, direction, source = "any") {
  return `${signalId}:${direction}:${source}`;
}

async function loadDismissedSuggestionKeys(workspaceId) {
  const keys = new Set();
  const [rows, auditRows] = await Promise.all([
    queryAll(
      `SELECT signal_id, direction, source, suggestion_id
       FROM threshold_suggestion_dismissals
       WHERE workspace_id = ?`,
      [workspaceId]
    ),
    queryAll(
      `SELECT details_json FROM audit_events
       WHERE workspace_id = ? AND event_type IN ('THRESHOLD_SUGGESTION_DISMISSED', 'THRESHOLD_SUGGESTION_APPLIED')
       ORDER BY id DESC LIMIT 500`,
      [workspaceId]
    )
  ]);

  for (const row of rows) {
    keys.add(dismissKey(row.signal_id, row.direction, row.source || "any"));
    keys.add(dismissKey(row.signal_id, row.direction, "any"));
    if (row.suggestion_id) keys.add(String(row.suggestion_id));
  }

  for (const row of auditRows) {
    try {
      const d = JSON.parse(row.details_json || "{}");
      if (d.suggestion_id) keys.add(String(d.suggestion_id));
      if (d.signal_id && d.direction) {
        keys.add(dismissKey(d.signal_id, d.direction, d.source || "any"));
        keys.add(dismissKey(d.signal_id, d.direction, "any"));
      }
    } catch {
      /* ignore */
    }
  }

  return keys;
}

function isSuggestionDismissed(dismissedKeys, suggestion) {
  if (!suggestion) return false;
  const source = suggestion.source || "signal_history";
  if (dismissedKeys.has(suggestion.id)) return true;
  if (dismissedKeys.has(dismissKey(suggestion.signal_id, suggestion.direction, source))) return true;
  if (dismissedKeys.has(dismissKey(suggestion.signal_id, suggestion.direction, "any"))) return true;
  return false;
}

async function recordSuggestionDismissal(workspaceId, suggestion, reason = "not_now") {
  const source = suggestion.source || "signal_history";
  const ts = nowIso();
  await run(
    `INSERT INTO threshold_suggestion_dismissals
      (workspace_id, signal_id, direction, source, suggestion_id, reason, dismissed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(workspace_id, signal_id, direction, source) DO UPDATE SET
       suggestion_id = excluded.suggestion_id,
       reason = excluded.reason,
       dismissed_at = excluded.dismissed_at`,
    [
      workspaceId,
      suggestion.signal_id,
      suggestion.direction,
      source,
      suggestion.id || null,
      typeof reason === "string" ? reason : "not_now",
      ts
    ]
  );
  // Broad dismiss so prod re-alignments on new releases stay suppressed.
  if (source === "prod_alignment") {
    await run(
      `INSERT INTO threshold_suggestion_dismissals
        (workspace_id, signal_id, direction, source, suggestion_id, reason, dismissed_at)
       VALUES (?, ?, ?, 'any', ?, ?, ?)
       ON CONFLICT(workspace_id, signal_id, direction, source) DO UPDATE SET
         suggestion_id = excluded.suggestion_id,
         reason = excluded.reason,
         dismissed_at = excluded.dismissed_at`,
      [workspaceId, suggestion.signal_id, suggestion.direction, suggestion.id || null, reason, ts]
    );
  }
}

module.exports = {
  loadDismissedSuggestionKeys,
  isSuggestionDismissed,
  recordSuggestionDismissal,
  dismissKey
};
