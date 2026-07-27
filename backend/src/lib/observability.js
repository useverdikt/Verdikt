"use strict";

/**
 * Lightweight structured logging + process-local counters.
 * Set LOG_JSON=1 for single-line JSON (matches requestLog). Counters are per-process —
 * use log lines for cross-process aggregation when jobs run in the worker.
 */

const counters = new Map();

function isLogJson() {
  return process.env.LOG_JSON === "1";
}

function formatFields(fields) {
  return Object.entries(fields || {})
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
    .join(" ");
}

/**
 * @param {"info"|"warn"|"error"} level
 * @param {string} event
 * @param {Record<string, unknown>} [fields]
 */
function log(level, event, fields = {}) {
  const ts = new Date().toISOString();
  const payload = { ts, level, event, ...fields };
  if (isLogJson()) {
    const line = JSON.stringify(payload);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
    return;
  }
  const detail = formatFields(fields);
  const msg = detail ? `[${event}] ${detail}` : `[${event}]`;
  if (level === "error") console.error(msg);
  else if (level === "warn") console.warn(msg);
  else console.log(msg);
}

function inc(name, by = 1) {
  const key = String(name || "");
  if (!key) return 0;
  const next = (counters.get(key) || 0) + Number(by || 0);
  counters.set(key, next);
  return next;
}

function snapshotCounters() {
  return Object.fromEntries(counters.entries());
}

function resetCounters() {
  counters.clear();
}

module.exports = {
  log,
  inc,
  snapshotCounters,
  resetCounters,
  isLogJson
};
