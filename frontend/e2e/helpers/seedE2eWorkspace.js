/**
 * Ensures ws_demo has at least one server-backed CERTIFIED release for Playwright UI tests.
 * Uses the same auth cookies produced by global-setup login (no client-side demo injection).
 */
const FIXTURE_VERSION = "e2e-playwright-fixture";

function cookieHeaderFromPlaywrightCookies(cookies) {
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

function csrfFromPlaywrightCookies(cookies) {
  return cookies.find((c) => c.name === "vdk_csrf")?.value || "";
}

function authHeaders(cookies) {
  const headers = {
    Cookie: cookieHeaderFromPlaywrightCookies(cookies),
    "Content-Type": "application/json"
  };
  const csrf = csrfFromPlaywrightCookies(cookies);
  if (csrf) headers["X-CSRF-Token"] = csrf;
  return headers;
}

export async function ensureE2eFixtureRelease({ apiBase, cookies, workspaceId }) {
  if (!workspaceId) return null;
  const headers = authHeaders(cookies);

  const listRes = await fetch(`${apiBase}/api/workspaces/${workspaceId}/releases?limit=50`, { headers });
  if (!listRes.ok) {
    const text = await listRes.text();
    throw new Error(`E2E seed: list releases failed ${listRes.status} ${text}`);
  }
  const list = await listRes.json();
  const existing = (list.releases || []).find((r) => r.version === FIXTURE_VERSION);
  if (existing?.id) return existing.id;

  const createRes = await fetch(`${apiBase}/api/workspaces/${workspaceId}/releases`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      version: FIXTURE_VERSION,
      release_type: "model_update",
      environment: "pre-prod"
    })
  });
  if (!createRes.ok) {
    const text = await createRes.text();
    throw new Error(`E2E seed: create release failed ${createRes.status} ${text}`);
  }
  const created = await createRes.json();
  const relId = created?.id;
  if (!relId) throw new Error("E2E seed: create release returned no id");

  const signalsRes = await fetch(`${apiBase}/api/releases/${relId}/signals`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      source: "e2e_seed",
      signals: {
        accuracy: 92,
        safety: 95,
        tone: 90,
        hallucination: 93,
        relevance: 89,
        p95latency: 240,
        p99latency: 480
      }
    })
  });
  if (!signalsRes.ok) {
    const text = await signalsRes.text();
    throw new Error(`E2E seed: ingest signals failed ${signalsRes.status} ${text}`);
  }

  const detailRes = await fetch(`${apiBase}/api/releases/${relId}`, { headers });
  if (!detailRes.ok) {
    const text = await detailRes.text();
    throw new Error(`E2E seed: get release failed ${detailRes.status} ${text}`);
  }
  const detail = await detailRes.json();
  const status = detail?.release?.status;
  if (status !== "CERTIFIED" && status !== "UNCERTIFIED") {
    throw new Error(`E2E seed: expected terminal verdict status, got ${status}`);
  }
  return relId;
}
