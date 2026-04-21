/**
 * One login per test run → Playwright storageState (avoids POST /api/auth/login per test and rate limits).
 * Runs after webServer is up (Playwright order).
 * Session is HttpOnly cookies + persisted client snapshot (no JWT in localStorage).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API = "http://127.0.0.1:8787";
const ORIGIN = "http://127.0.0.1:5174";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function playwrightCookiesFromResponse(res) {
  const list =
    typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : parseSetCookieFallback(res);
  const out = [];
  for (const line of list) {
    const [main] = String(line).split(";");
    const eq = main.indexOf("=");
    if (eq <= 0) continue;
    const name = main.slice(0, eq).trim();
    const value = main.slice(eq + 1).trim();
    const lower = String(line).toLowerCase();
    out.push({
      name,
      value,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: lower.includes("httponly"),
      secure: false,
      sameSite: "Lax"
    });
  }
  return out;
}

function parseSetCookieFallback(res) {
  const raw = res.headers.get("set-cookie");
  if (!raw) return [];
  return raw.split(/,(?=[^;]+?=)/).map((s) => s.trim());
}

export default async function globalSetup() {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "demo@verdikt.local", password: "demo123" })
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`globalSetup login failed: ${res.status} ${t}`);
  }
  const { user } = await res.json();
  const dir = path.join(__dirname, ".auth");
  fs.mkdirSync(dir, { recursive: true });
  const localStorage = [];
  if (user) {
    localStorage.push({ name: "vdk3_currentUser", value: JSON.stringify(user) });
  }
  if (user?.workspace_id != null) {
    localStorage.push({ name: "vdk3_workspace_id", value: String(user.workspace_id) });
  }
  const storage = {
    cookies: playwrightCookiesFromResponse(res),
    origins: [{ origin: ORIGIN, localStorage }]
  };
  fs.writeFileSync(path.join(dir, "storage.json"), JSON.stringify(storage));
}
