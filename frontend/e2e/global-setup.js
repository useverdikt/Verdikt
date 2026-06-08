/**
 * One login per test run → Playwright storageState (avoids POST /api/auth/login per test and rate limits).
 * Runs after webServer is up (Playwright order).
 * Session is HttpOnly cookies + persisted client snapshot (no JWT in localStorage).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureE2eCollectingRelease, ensureE2eFixtureRelease } from "./helpers/seedE2eWorkspace.js";

const API = "http://127.0.0.1:8787";
const ORIGIN = "http://127.0.0.1:5174";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

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
      // Playwright storageState expects a numeric expires value.
      // -1 means session cookie (no explicit Expires/Max-Age).
      expires: -1,
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
  // In CI, Playwright marks webServer ready when Vite is available; backend can
  // still be finishing startup/migrations. Retry auth bootstrap briefly.
  let res;
  let lastErr;
  for (let i = 0; i < 30; i++) {
    try {
      const health = await fetch(`${API}/health`);
      if (!health.ok) throw new Error(`health ${health.status}`);
      res = await fetch(`${API}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "demo@verdikt.local", password: "demo123" })
      });
      break;
    } catch (e) {
      lastErr = e;
      await sleep(500);
    }
  }
  if (!res) {
    throw new Error(`globalSetup login failed: backend not reachable (${String(lastErr?.message || lastErr)})`);
  }
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`globalSetup login failed: ${res.status} ${t}`);
  }
  const { user } = await res.json();
  const cookies = playwrightCookiesFromResponse(res);
  if (user?.workspace_id) {
    await ensureE2eFixtureRelease({
      apiBase: API,
      cookies,
      workspaceId: user.workspace_id
    });
    await ensureE2eCollectingRelease({
      apiBase: API,
      cookies,
      workspaceId: user.workspace_id
    });
  }
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
    cookies,
    origins: [{ origin: ORIGIN, localStorage }]
  };
  fs.writeFileSync(path.join(dir, "storage.json"), JSON.stringify(storage));
}
