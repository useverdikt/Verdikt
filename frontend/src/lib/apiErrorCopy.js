/**
 * Map raw API / sync error strings to user-facing banner copy.
 * Technical detail is kept for an optional expand control in ApiBanner.
 */

/**
 * Prefer the standardized API body `{ message, error }` for display.
 * `error` is a machine code; `message` is human-readable.
 * @param {unknown} data
 * @param {string} [fallback]
 */
export function messageFromApiBody(data, fallback = "Request failed") {
  if (data && typeof data === "object") {
    const message = typeof data.message === "string" ? data.message.trim() : "";
    if (message) return message;
    const error = typeof data.error === "string" ? data.error.trim() : "";
    if (error) return error;
  }
  return fallback;
}

/** @param {string | null | undefined} raw */
export function resolveApiBanner(raw) {
  if (!raw) return null;
  const detail = String(raw).trim();
  if (!detail) return null;
  const lower = detail.toLowerCase();

  if (/threshold/.test(lower)) {
    return { title: "Couldn't save thresholds", detail };
  }
  if (/signal ingest|ingest failed/.test(lower)) {
    return { title: "Couldn't apply signals to this release", detail };
  }
  if (/override/.test(lower)) {
    return { title: "Override couldn't be saved", detail };
  }
  if (/sync workspace|refresh workspace|failed to sync/.test(lower)) {
    return { title: "Couldn't refresh workspace data", detail };
  }
  if (/audit/.test(lower)) {
    return { title: "Couldn't load audit log", detail };
  }
  if (/release/.test(lower) && /load|refresh|detail|record/.test(lower)) {
    return { title: "Couldn't load release data", detail };
  }
  if (/intelligence decision|intelligence outcome/.test(lower)) {
    return { title: "Couldn't save intelligence decision", detail };
  }
  if (/certification session|open certification|add release/.test(lower)) {
    return { title: "Couldn't create or open the release", detail };
  }
  if (/suggestion/.test(lower)) {
    return { title: "Couldn't update threshold suggestion", detail };
  }
  if (/401|403|unauthorized|forbidden|sign in|login/.test(lower)) {
    return { title: "Session expired — sign in again", detail };
  }

  return { title: "Something went wrong — try again", detail };
}
