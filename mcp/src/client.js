import { ensureSessionId } from "./session.js";

export { generateAgentSessionId, resolveSessionId, bindReleaseSession } from "./session.js";

const BASE = (process.env.VERDIKT_API_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const API_KEY = (process.env.VERDIKT_API_KEY || "").trim();
const WORKSPACE_ID = (process.env.VERDIKT_WORKSPACE_ID || "").trim();

function requireConfig() {
  if (!API_KEY) throw new Error("VERDIKT_API_KEY is required");
  if (!WORKSPACE_ID) throw new Error("VERDIKT_WORKSPACE_ID is required");
}

/**
 * @param {object} [opts]
 * @param {string} [opts.sessionId] - Explicit agent session (tool arg session_id)
 * @param {string} [opts.releaseId] - Bind lookup for follow-up calls without session_id
 * @param {string} [opts.agentLabel] - Optional X-Verdikt-Agent-Label header
 * @param {boolean} [opts.createSessionIfMissing] - Mint session when none resolved (create_release)
 */
export async function apiRequest(method, path, body, opts = {}) {
  requireConfig();
  const { sessionId, releaseId, agentLabel, createSessionIfMissing = false } = opts;
  const resolvedSession = ensureSessionId({
    sessionId,
    releaseId,
    createIfMissing: createSessionIfMissing
  });

  const headers = {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json"
  };
  if (resolvedSession) headers["X-Verdikt-Agent-Session"] = resolvedSession;
  if (agentLabel) headers["X-Verdikt-Agent-Label"] = String(agentLabel).trim().slice(0, 120);

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg = data?.error || data?.message || res.statusText;
    throw new Error(`${res.status} ${msg}`);
  }
  return data;
}

export function jsonResult(payload) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }]
  };
}

export function withAgentSession(payload, sessionId) {
  if (!sessionId) return payload;
  return { ...payload, agent_session_id: sessionId };
}

export { BASE, WORKSPACE_ID };
