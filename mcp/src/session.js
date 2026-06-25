import crypto from "node:crypto";

/** Matches backend agentSession.SESSION_ID_RE */
const SESSION_ID_RE = /^as_[a-zA-Z0-9_-]{8,80}$/;

/** release_id → session_id for single-process follow-ups (create_release → check_gate). */
const releaseSessions = new Map();

const ENV_SESSION = (process.env.VERDIKT_AGENT_SESSION_ID || "").trim();

export function generateAgentSessionId() {
  return `as_${crypto.randomUUID().replace(/-/g, "")}`;
}

export function normalizeSessionId(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  if (!SESSION_ID_RE.test(s)) {
    throw new Error(`Invalid session_id "${s}" — expected as_<id> (8–80 alphanumeric/._- chars)`);
  }
  return s;
}

export function bindReleaseSession(releaseId, sessionId) {
  const rid = String(releaseId || "").trim();
  const sid = normalizeSessionId(sessionId);
  if (rid && sid) releaseSessions.set(rid, sid);
}

export function getReleaseSession(releaseId) {
  const rid = String(releaseId || "").trim();
  return rid ? releaseSessions.get(rid) || null : null;
}

/**
 * Resolve audit session for an MCP tool call.
 * Priority: explicit session_id → release-bound session → VERDIKT_AGENT_SESSION_ID env.
 */
export function resolveSessionId({ sessionId, releaseId } = {}) {
  const explicit = normalizeSessionId(sessionId);
  if (explicit) return explicit;
  if (releaseId) {
    const bound = getReleaseSession(releaseId);
    if (bound) return bound;
  }
  if (ENV_SESSION) return normalizeSessionId(ENV_SESSION);
  return null;
}

/** Like resolveSessionId but mints a new ID when none resolved (create_release flows). */
export function ensureSessionId({ sessionId, releaseId, createIfMissing = false } = {}) {
  const resolved = resolveSessionId({ sessionId, releaseId });
  if (resolved) return resolved;
  if (createIfMissing) return generateAgentSessionId();
  return null;
}

export function clearReleaseSessionsForTests() {
  releaseSessions.clear();
}
