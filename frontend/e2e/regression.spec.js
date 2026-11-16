/**
 * Regression pack — release-dashboard behaviours that journey specs do not cover.
 * Weak "page loads" / health / Array.isArray API checks live elsewhere or were removed.
 */
import { test, expect } from "@playwright/test";
import { waitForReleaseRows, waitForSessionGate } from "./helpers/shell.js";
import {
  ensureE2eCollectingRelease,
  seedCertGateSmokeRelease
} from "./helpers/seedE2eWorkspace.js";

const API = "http://127.0.0.1:8787";

test.describe("deep link and certification record", () => {
  test("hub_links.release opens the named certified release", async ({ page, context }) => {
    await page.goto("/releases");
    await waitForSessionGate(page);
    const workspaceId = await page.evaluate(() => localStorage.getItem("vdk3_workspace_id"));
    const cookies = await context.cookies();
    const seeded = await seedCertGateSmokeRelease({ apiBase: API, cookies, workspaceId });
    expect(seeded.status).toMatch(/^CERTIFIED/);

    const gate = await page.request.get(`${API}/api/releases/${seeded.releaseId}/gate`);
    expect(gate.ok(), await gate.text()).toBeTruthy();
    const gateBody = await gate.json();
    expect(gateBody.action).toBe("merge");
    const deepLink =
      gateBody.hub_links?.release ||
      gateBody.governance_brief?.hub_links?.release ||
      `/releases?release=${seeded.releaseId}`;
    const path = deepLink.startsWith("http") ? new URL(deepLink).pathname + new URL(deepLink).search : deepLink;

    await page.goto(path);
    await waitForSessionGate(page);
    await waitForReleaseRows(page);

    const row = page
      .locator(".release-row")
      .filter({ has: page.locator(`.release-version[title="${seeded.version}"]`) })
      .first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.locator(".vbadge")).toContainText(/CERTIFIED/i);
    await expect(page.locator(".release-detail").first()).toBeVisible({ timeout: 15_000 });
  });

  test("certification record for a certified release shows its verdict", async ({ page, context }) => {
    await page.goto("/releases");
    await waitForSessionGate(page);
    const workspaceId = await page.evaluate(() => localStorage.getItem("vdk3_workspace_id"));
    const cookies = await context.cookies();
    const seeded = await seedCertGateSmokeRelease({ apiBase: API, cookies, workspaceId });
    expect(seeded.status).toMatch(/^CERTIFIED/);

    await page.goto("/releases");
    await waitForReleaseRows(page);
    await page.getByRole("button", { name: /Sync workspace/i }).click();
    await expect(page.getByRole("button", { name: /↻ Sync workspace/i })).toBeVisible({ timeout: 20_000 });

    const row = page
      .locator(".release-row")
      .filter({ has: page.locator(`.release-version[title="${seeded.version}"]`) })
      .first();
    await expect(row).toBeVisible({ timeout: 25_000 });
    await row.click();
    await page.getByRole("button", { name: /View full record/i }).click();
    const dialog = page.locator('[role="dialog"]').filter({ hasText: "CERTIFICATION RECORD" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/CERTIFIED/i);
    await expect(dialog).toContainText(seeded.version);
  });
});

test.describe("collecting row actions", () => {
  test("View live stream opens SSE modal; Extend deadline updates server window", async ({ page, context }) => {
    await page.goto("/releases");
    await waitForSessionGate(page);
    const workspaceId = await page.evaluate(() => localStorage.getItem("vdk3_workspace_id"));
    const cookies = await context.cookies();
    const collecting = await ensureE2eCollectingRelease({
      apiBase: API,
      cookies,
      workspaceId
    });
    expect(collecting?.id).toBeTruthy();

    const beforeRes = await page.request.get(`${API}/api/releases/${collecting.id}`);
    expect(beforeRes.ok(), await beforeRes.text()).toBeTruthy();
    const beforeBody = await beforeRes.json();
    const beforeDeadline =
      beforeBody.release?.collection_deadline || beforeBody.collection_deadline || null;

    await page.goto("/releases");
    await waitForReleaseRows(page);
    await page.getByRole("button", { name: /Sync workspace/i }).click();
    await expect(page.getByRole("button", { name: /↻ Sync workspace/i })).toBeVisible({ timeout: 20_000 });

    const collectingRow = page
      .locator(".release-row")
      .filter({ has: page.locator(`.release-version[title="${collecting.version}"]`) })
      .first();
    await expect(collectingRow).toBeVisible({ timeout: 25_000 });
    await collectingRow.click();

    const collectingDetail = page.locator(".release-detail").filter({ hasText: /View live stream|Extend deadline/i });
    await expect(collectingDetail).toBeVisible({ timeout: 15_000 });

    await collectingDetail.getByRole("button", { name: /View live stream/i }).click();
    const liveDialog = page.getByRole("dialog").filter({ hasText: "LIVE SIGNAL STREAM" });
    await expect(liveDialog).toBeVisible({ timeout: 10_000 });
    await liveDialog.getByRole("button", { name: "Close" }).click();
    await expect(liveDialog).toHaveCount(0);

    await expect(collectingDetail).toBeVisible();
    await collectingDetail.getByRole("button", { name: /Extend deadline/i }).click();
    await expect(page.locator("body")).toContainText(/Collection deadline extended/i);

    const afterRes = await page.request.get(`${API}/api/releases/${collecting.id}`);
    expect(afterRes.ok(), await afterRes.text()).toBeTruthy();
    const afterBody = await afterRes.json();
    const afterDeadline = afterBody.release?.collection_deadline || afterBody.collection_deadline || null;
    expect(afterDeadline).toBeTruthy();
    if (beforeDeadline) {
      expect(new Date(afterDeadline).getTime()).toBeGreaterThan(new Date(beforeDeadline).getTime());
    }
  });
});
