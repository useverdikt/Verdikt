const BASE = (process.env.VERDIKT_API_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const API_KEY = (process.env.VERDIKT_API_KEY || "").trim();
const WORKSPACE_ID = (process.env.VERDIKT_WORKSPACE_ID || "").trim();

function requireConfig() {
  if (!API_KEY) throw new Error("VERDIKT_API_KEY is required");
  if (!WORKSPACE_ID) throw new Error("VERDIKT_WORKSPACE_ID is required");
}

export async function apiRequest(method, path, body) {
  requireConfig();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
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

export { BASE, WORKSPACE_ID };
