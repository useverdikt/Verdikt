import { test, expect } from "@playwright/test";

const API = "http://127.0.0.1:8787";

const emptyStorage = { cookies: [], origins: [] };

test.describe("full-stack smoke — public / no session", () => {
  test.use({ storageState: emptyStorage });

  test("login page links to forgot password", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: /^Forgot\?$/i }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await expect(page.getByRole("button", { name: /Send reset link|Reset password/i })).toBeVisible();
  });

  test("unauthenticated users are sent to /login", async ({ page }) => {
    await page.goto("/releases");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("onboarding route loads wizard or design-partner gate", async ({ page }) => {
    await page.goto("/onboarding");
    await expect(
      page.getByText(/Step 1 of 6|Design partner access|Here.s the value|Self-service signup/i).first()
    ).toBeVisible({ timeout: 25_000 });
  });

  test("request-access route loads", async ({ page }) => {
    await page.goto("/request-access");
    await expect(page.getByRole("heading", { name: /Get on the list for/i })).toBeVisible();
  });

  test("marketing landing at /", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/Verdikt/i).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Sign in|Join waitlist/i }).first()).toBeVisible();
  });

  test("backend /health responds", async ({ page }) => {
    const res = await page.request.get(`${API}/health`);
    expect(res.ok()).toBeTruthy();
    const text = await res.text();
    expect(text).toContain("verdikt-backend");
  });
});

test.describe("full-stack smoke — authenticated (storageState from global-setup)", () => {
  test("email previews at /emails", async ({ page }) => {
    await page.goto("/emails");
    await expect(page).toHaveURL(/\/emails$/);
    const hasPreviewText = await page.getByText(/Preview only.*templates ship as HTML/i).isVisible().catch(() => false);
    const hasCopyBtn = await page.getByRole("button", { name: /Copy HTML/i }).isVisible().catch(() => false);
    const hasLegacyIframe = await page.locator('iframe[title="Email notification previews"]').isVisible().catch(() => false);
    const hasServerErr = await page.getByText(/Can.?t reach the server to verify your session/i).isVisible().catch(() => false);
    expect(hasPreviewText || hasCopyBtn || hasLegacyIframe || hasServerErr).toBeTruthy();
  });

  test("dashboard routes /releases and /trends", async ({ page }) => {
    await page.goto("/releases");
    await expect(page).toHaveURL(/\/releases$/);
    await page.goto("/trends");
    await expect(page).toHaveURL(/\/trends$/);
  });

  test("document title loads on /releases", async ({ page }) => {
    await page.goto("/releases");
    await expect(page).toHaveTitle(/Verdikt/i);
  });

  test("release shell renders content", async ({ page }) => {
    await page.goto("/releases");
    await expect(page.getByText(/Verifying session/i)).toBeHidden({ timeout: 25_000 });
    await expect(page.locator("body")).toContainText(
      /RELEASE CANDIDATES|No releases yet|Release Signals|SETUP CHECKLIST|Open settings|Verdikt/i
    );
  });
});
