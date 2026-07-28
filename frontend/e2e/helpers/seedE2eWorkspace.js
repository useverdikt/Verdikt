/**
 * Ensures ws_demo has at least one server-backed CERTIFIED release for Playwright UI tests.
 * Uses the same auth cookies produced by global-setup login (no client-side demo injection).
 */
const FIXTURE_VERSION = "e2e-playwright-fixture";
const COLLECTING_FIXTURE_VERSION = "e2e-playwright-collecting";

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

/** Passing signals that certify against default workspace thresholds. */
export const CERT_GATE_PASSING_SIGNALS = {
  accuracy: 95,
  safety: 95,
  tone: 90,
  hallucination: 95,
  relevance: 90,
  smoke: 100,
  e2e_regression: 100,
  manual_qa_pct: 100
};

/** Fresh workspaces start with empty definitions — adopt library signals so cert + thresholds UI are real. */
export async function ensureLibrarySignalsAdopted({ apiBase, cookies, workspaceId, signalIds }) {
  if (!workspaceId) return;
  const headers = authHeaders(cookies);
  const catalogRes = await fetch(`${apiBase}/api/workspaces/${workspaceId}/signal-definitions`, { headers });
  if (!catalogRes.ok) {
    const text = await catalogRes.text();
    throw new Error(`E2E adopt: catalog failed ${catalogRes.status} ${text}`);
  }
  const catalog = await catalogRes.json();
  const adopted = new Set((catalog.definitions || []).map((d) => d.signal_id));
  const libraryIds = new Set((catalog.library || []).map((d) => d.signal_id));
  for (const signalId of signalIds) {
    if (adopted.has(signalId)) continue;
    if (!libraryIds.has(signalId)) continue;
    const adoptRes = await fetch(`${apiBase}/api/workspaces/${workspaceId}/signal-definitions/adopt`, {
      method: "POST",
      headers,
      body: JSON.stringify({ signal_id: signalId, required_for_certification: true })
    });
    if (!adoptRes.ok) {
      const text = await adoptRes.text();
      throw new Error(`E2E adopt: ${signalId} failed ${adoptRes.status} ${text}`);
    }
  }
  const after = await fetch(`${apiBase}/api/workspaces/${workspaceId}/signal-definitions`, { headers });
  if (!after.ok) {
    const text = await after.text();
    throw new Error(`E2E adopt: re-list failed ${after.status} ${text}`);
  }
  const afterBody = await after.json();
  if (!(afterBody.definitions || []).length) {
    throw new Error("E2E adopt: workspace still has no signal definitions");
  }
}

/**
 * Full cert→signal→gate path for Playwright smoke:
 * adopt signals → create release (commit_sha) → ingest → CERTIFIED → ready for gate / brief UI.
 */
export async function seedCertGateSmokeRelease({ apiBase, cookies, workspaceId }) {
  if (!workspaceId) throw new Error("E2E cert-gate seed: workspaceId required");
  const headers = authHeaders(cookies);
  const stamp = Date.now().toString(36);
  const version = `e2e-cert-gate-${stamp}`;
  const commitSha = Array.from({ length: 40 }, () => Math.floor(Math.random() * 16).toString(16)).join("");

  await ensureLibrarySignalsAdopted({
    apiBase,
    cookies,
    workspaceId,
    signalIds: Object.keys(CERT_GATE_PASSING_SIGNALS)
  });

  const createRes = await fetch(`${apiBase}/api/workspaces/${workspaceId}/releases`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      version,
      release_type: "model_update",
      environment: "pre-prod",
      commit_sha: commitSha,
      pr_number: 1601,
      github_owner: "useverdikt",
      github_repo: "e2e-smoke"
    })
  });
  if (!createRes.ok) {
    const text = await createRes.text();
    throw new Error(`E2E cert-gate seed: create failed ${createRes.status} ${text}`);
  }
  const created = await createRes.json();
  const releaseId = created?.id;
  if (!releaseId) throw new Error("E2E cert-gate seed: create returned no id");

  const signalsRes = await fetch(`${apiBase}/api/releases/${releaseId}/signals`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      source: "e2e_cert_gate_smoke",
      signals: CERT_GATE_PASSING_SIGNALS
    })
  });
  if (!signalsRes.ok) {
    const text = await signalsRes.text();
    throw new Error(`E2E cert-gate seed: signals failed ${signalsRes.status} ${text}`);
  }
  const ingest = await signalsRes.json();
  if (ingest.status !== "CERTIFIED" && ingest.status !== "CERTIFIED_WITH_OVERRIDE") {
    throw new Error(`E2E cert-gate seed: expected CERTIFIED*, got ${ingest.status}`);
  }

  return {
    releaseId,
    version,
    commitSha,
    workspaceId,
    status: ingest.status
  };
}

/** COLLECTING release for live-stream / extend-deadline UI tests (no signal ingest). */
export async function ensureE2eCollectingRelease({ apiBase, cookies, workspaceId }) {
  if (!workspaceId) return null;
  const headers = authHeaders(cookies);

  const listRes = await fetch(`${apiBase}/api/workspaces/${workspaceId}/releases?limit=50`, { headers });
  if (!listRes.ok) {
    const text = await listRes.text();
    throw new Error(`E2E seed: list releases failed ${listRes.status} ${text}`);
  }
  const list = await listRes.json();
  const collecting = (list.releases || []).find((r) => String(r.status || "").toUpperCase() === "COLLECTING");
  if (collecting?.id) {
    return { id: collecting.id, version: collecting.version || COLLECTING_FIXTURE_VERSION };
  }

  const version = `${COLLECTING_FIXTURE_VERSION}-${Date.now().toString(36)}`;
  const createRes = await fetch(`${apiBase}/api/workspaces/${workspaceId}/releases`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      version,
      release_type: "model_update",
      environment: "pre-prod"
    })
  });
  if (!createRes.ok) {
    const text = await createRes.text();
    throw new Error(`E2E seed: create collecting release failed ${createRes.status} ${text}`);
  }
  const created = await createRes.json();
  if (created.status !== "COLLECTING") {
    throw new Error(`E2E seed: expected COLLECTING status, got ${created.status}`);
  }
  return { id: created.id, version };
}
