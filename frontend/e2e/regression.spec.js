/**
 * Regression pack — authenticated flows on real API + Vite (playwright webServer).
 * Complements app.spec.js / full-coverage.spec.js with release-dashboard modals and API checks.
 * Run: npm run test:e2e (from frontend/)
 */
import { test, expect } from "@playwright/test";

const API = "http://127.0.0.1:8787";

test.describe("releases dashboard (authenticated)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/releases");
    await expect(page.getByText(/Verifying session/i)).toBeHidden({ timeout: 25_000 });
  });

  test("+ New release opens Start certification modal", async ({ page }) => {
    await page.getByRole("button", { name: /\+ New release/i }).click();
    await expect(page.getByText("NEW CERTIFICATION SESSION")).toBeVisible();
    await expect(page.getByRole("heading", { name: /Start certification/i })).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByText("NEW CERTIFICATION SESSION")).toBeHidden();
  });

  test("expand row → View full record opens certification record modal", async ({ page }) => {
    const firstRow = page.locator(".release-row").first();
    await expect(firstRow).toBeVisible({ timeout: 15_000 });
    await firstRow.click();
    await page.getByRole("button", { name: /View full record/i }).click({ force: true });
    await expect(page.getByText("CERTIFICATION RECORD").first()).toBeVisible();
    await page.locator('[role="dialog"]').filter({ hasText: "CERTIFICATION RECORD" }).getByRole("button", { name: "✕" }).click();
    await expect(page.locator('[role="dialog"]').filter({ hasText: "CERTIFICATION RECORD" })).toHaveCount(0);
  });

  test("certification record → Share snapshot opens share dialog", async ({ page }) => {
    const firstRow = page.locator(".release-row").first();
    await expect(firstRow).toBeVisible({ timeout: 15_000 });
    await firstRow.click();
    await page.getByRole("button", { name: /View full record/i }).click({ force: true });
    await page.getByRole("button", { name: /Share snapshot/i }).click();
    await expect(page.getByRole("dialog").filter({ hasText: /Certified|Uncertified/i }).first()).toBeVisible({
      timeout: 10_000
    });
    await page.getByRole("button", { name: "✕" }).last().click();
  });
});

test.describe("collecting row actions (still toast-only until webhooks / server window exist)", () => {
  test("View live stream + Extend deadline show guidance toast when a collecting row exists", async ({ page }, testInfo) => {
    await page.goto("/releases");
    await expect(page.getByText(/Verifying session/i)).toBeHidden({ timeout: 25_000 });
    const collectingRow = page.locator(".releases-table .release-row.coll-pulse").first();
    if ((await collectingRow.count()) === 0) {
      testInfo.skip(true, "No COLLECTING row in current dataset — seed data may differ");
    }

    const collectingDetail = () =>
      page.locator(".release-detail").filter({ hasText: /View live stream|Extend deadline/i });

    /** Expand the row until the collecting detail (actions stack) is in the DOM. */
    const ensureCollectingActions = async () => {
      for (let i = 0; i < 4; i++) {
        const panel = collectingDetail().first();
        if (await panel.isVisible().catch(() => false)) return;
        await collectingRow.scrollIntoViewIfNeeded();
        await collectingRow.click();
      }
      throw new Error("Could not open collecting release detail");
    };

    await ensureCollectingActions();
    await collectingDetail().getByRole("button", { name: /Extend deadline/i }).click({ force: true });
    await expect(page.locator("body")).toContainText(/Extend deadline:|collection window|COLLECTING/i);

    // A releases refresh after the toast can reset expanded state — open detail again before the second action.
    await ensureCollectingActions();
    await collectingDetail().getByRole("button", { name: /View live stream/i }).click({ force: true });
    await expect(page.locator("body")).toContainText(/Live stream:|webhooks|Settings/i);
  });
});

test.describe("API smoke (authenticated request)", () => {
  test("login + GET workspace releases returns JSON list", async ({ request }) => {
    const login = await request.post(`${API}/api/auth/login`, {
      data: { email: "demo@verdikt.local", password: "demo123" }
    });
    expect(login.ok(), await login.text()).toBeTruthy();
    const { token, user } = await login.json();
    const ws = user?.workspace_id || "ws_demo";
    const res = await request.get(`${API}/api/workspaces/${ws}/releases?limit=10`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(res.ok(), await res.text()).toBeTruthy();
    const data = await res.json();
    expect(data).toHaveProperty("releases");
    expect(Array.isArray(data.releases)).toBeTruthy();
  });

  test("health + ready", async ({ request }) => {
    const h = await request.get(`${API}/health`);
    expect(h.ok()).toBeTruthy();
    const r = await request.get(`${API}/health/ready`);
    expect(r.ok()).toBeTruthy();
  });
});
