/**
 * Highest-value journey smoke: create release → post signals → CERTIFIED →
 * gate action merge (API + Release brief banner) → threshold save (UI).
 *
 * Run: npx playwright test e2e/cert-gate-smoke.spec.js
 */
import { test, expect } from "@playwright/test";
import { waitForReleaseRows, waitForSessionGate } from "./helpers/shell.js";
import { seedCertGateSmokeRelease } from "./helpers/seedE2eWorkspace.js";

const API = "http://127.0.0.1:8787";

async function workspaceIdFromPage(page) {
  return page.evaluate(() => localStorage.getItem("vdk3_workspace_id"));
}

test.describe("cert → signal → gate smoke", () => {
  test("API certifies, gate merges; UI shows status + brief; thresholds save", async ({ page, context }) => {
    await page.goto("/releases");
    await waitForSessionGate(page);

    const workspaceId = await workspaceIdFromPage(page);
    expect(workspaceId, "workspace id from session").toBeTruthy();

    const cookies = await context.cookies();
    const seeded = await seedCertGateSmokeRelease({
      apiBase: API,
      cookies,
      workspaceId
    });
    expect(seeded.status).toMatch(/^CERTIFIED/);

    // Workspace gate by commit_sha (CI path).
    const gateBySha = await page.request.get(
      `${API}/api/workspaces/${workspaceId}/gate?commit_sha=${seeded.commitSha}&github_owner=useverdikt&github_repo=e2e-smoke&pr_number=1601`
    );
    expect(gateBySha.ok(), await gateBySha.text()).toBeTruthy();
    const gateShaBody = await gateBySha.json();
    expect(gateShaBody.release_id).toBe(seeded.releaseId);
    expect(gateShaBody.action).toBe("merge");
    expect(gateShaBody.can_merge).toBeTruthy();

    // Release-id gate + brief (same payload the UI banner uses).
    const gateById = await page.request.get(`${API}/api/releases/${seeded.releaseId}/gate`);
    expect(gateById.ok(), await gateById.text()).toBeTruthy();
    const gateIdBody = await gateById.json();
    expect(gateIdBody.action).toBe("merge");

    const briefRes = await page.request.get(`${API}/api/releases/${seeded.releaseId}/release-brief`);
    expect(briefRes.ok(), await briefRes.text()).toBeTruthy();
    const brief = await briefRes.json();
    expect(brief.gate_action).toBe("merge");

    // UI: status badge + Release brief gate chip (version display truncates; match title).
    await page.goto("/releases");
    await waitForReleaseRows(page);
    await page.getByRole("button", { name: /Sync workspace/i }).click();
    await expect(page.getByRole("button", { name: /Sync workspace|Syncing/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /↻ Sync workspace/i })).toBeVisible({ timeout: 20_000 });

    const row = page
      .locator(".release-row")
      .filter({ has: page.locator(`.release-version[title="${seeded.version}"]`) })
      .first();
    await expect(row).toBeVisible({ timeout: 25_000 });
    await expect(row.locator(".vbadge")).toContainText(/CERTIFIED/i);
    await row.click();

    await expect(page.locator(".release-detail").first()).toBeVisible({ timeout: 15_000 });
    const briefPanel = page.getByRole("region", { name: /Release brief/i });
    await expect(briefPanel).toBeVisible({ timeout: 20_000 });
    await expect(briefPanel).toContainText(/gate/i);
    await expect(briefPanel).toContainText(/merge/i);

    // Threshold save (human control-plane) — wait for adopted signal number inputs.
    await page.goto("/thresholds");
    await waitForSessionGate(page);
    await expect(page.getByRole("heading", { name: /Signals & thresholds/i })).toBeVisible({
      timeout: 20_000
    });
    await expect(page.getByText("Workspace signals")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/No workspace signals yet/i)).toHaveCount(0);

    const saveBtn = page.getByRole("button", { name: /Save Thresholds/i });
    await expect(saveBtn).toBeVisible();
    const firstNumber = page.locator('input[type="number"]').first();
    await expect(firstNumber).toBeVisible({ timeout: 20_000 });
    const before = await firstNumber.inputValue();
    const next = String(Number(before || "90") === 91 ? 90 : 91);
    await firstNumber.fill(next);
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();
    await expect(page.getByRole("button", { name: /✓ Saved/i })).toBeVisible({ timeout: 15_000 });

    // Frozen cert: live threshold edit must not flip a certified release off merge.
    const gateAfter = await page.request.get(`${API}/api/releases/${seeded.releaseId}/gate`);
    expect(gateAfter.ok(), await gateAfter.text()).toBeTruthy();
    const afterBody = await gateAfter.json();
    expect(afterBody.action).toBe("merge");
  });
});
