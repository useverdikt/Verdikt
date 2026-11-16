/**
 * Escalations inbox — creates a real escalation (with CSRF) and asserts it
 * appears in the UI. Override/revoke are covered by backend authzIsolation
 * and gateEnforcement HTTP tests; this file covers the human inbox surface.
 */
import { test, expect } from "@playwright/test";
import { waitForSessionGate } from "./helpers/shell.js";

const API = "http://127.0.0.1:8787";

function authHeadersFromCookies(cookies) {
  const headers = { "Content-Type": "application/json" };
  const csrf = cookies.find((c) => c.name === "vdk_csrf")?.value;
  if (csrf) headers["X-CSRF-Token"] = decodeURIComponent(csrf);
  return headers;
}

test.describe("escalations inbox", () => {
  test("escalate API creates a pending row the inbox lists by version", async ({ page, context, request }) => {
    await page.goto("/escalations");
    await waitForSessionGate(page);
    await expect(page.getByRole("heading", { name: "Escalation Inbox" })).toBeVisible({ timeout: 10_000 });

    const meRes = await request.get(`${API}/api/auth/me`);
    expect(meRes.ok(), await meRes.text()).toBeTruthy();
    const { user } = await meRes.json();
    const wsId = user.workspace_id;
    expect(wsId).toBeTruthy();

    const cookies = await context.cookies();
    const headers = authHeadersFromCookies(cookies);
    const version = `e2e-esc-${Date.now()}`;

    const relRes = await request.post(`${API}/api/workspaces/${wsId}/releases`, {
      headers,
      data: { version, release_type: "model_update" }
    });
    expect(relRes.ok(), await relRes.text()).toBeTruthy();
    const { id: releaseId } = await relRes.json();

    const escRes = await request.post(`${API}/api/releases/${releaseId}/escalate`, {
      headers,
      data: {
        reason: "E2E test escalation — accuracy below threshold after 3 retries",
        blocking_signals: ["accuracy"],
        attempted_fixes: ["re-ran evals", "checked dataset integrity"]
      }
    });
    expect(escRes.ok(), await escRes.text()).toBeTruthy();

    const listRes = await request.get(
      `${API}/api/workspaces/${wsId}/escalations?state=pending_human_review`
    );
    expect(listRes.ok(), await listRes.text()).toBeTruthy();
    const { escalations } = await listRes.json();
    const created = (escalations || []).find((e) => e.release_id === releaseId);
    expect(created).toBeTruthy();
    expect(created.state).toBe("pending_human_review");

    await page.goto("/escalations");
    await waitForSessionGate(page);
    await expect(page.getByText(version)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/something went wrong|unhandled error/i)).toBeHidden();
  });
});
