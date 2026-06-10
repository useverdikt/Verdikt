const API_BASE = "http://127.0.0.1:8787";

export function playwrightCookiesFromResponse(res) {
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

export async function registerUser({ email, password, name }) {
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, name })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`E2E register failed ${res.status}: ${text}`);
  }
}

export async function loginUser({ email, password }) {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`E2E login failed ${res.status}: ${text}`);
  }
  const { user } = await res.json();
  const cookies = playwrightCookiesFromResponse(res);
  return { user, cookies };
}

export async function applySessionToBrowser(context, page, { user, cookies }) {
  await context.addCookies(cookies);
  const snapshot = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    workspace_id: user.workspace_id
  };
  await page.addInitScript((stored) => {
    localStorage.setItem("vdk3_currentUser", JSON.stringify(stored));
    localStorage.setItem("vdk3_workspace_id", String(stored.workspace_id));
  }, snapshot);
}
