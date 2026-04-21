/**
 * Broad route and smoke coverage — not exhaustive of every modal, SSE stream, or permission matrix.
 * Session: `e2e/global-setup.js` logs in once; tests that need no session use `test.use({ storageState: emptyStorage })`.
 * Run: `npm run test:e2e` from `frontend/` (starts API + Vite via playwright.config.js).
 * Requires: `npx playwright install chromium` once per machine/CI image.
 */
import { test, expect } from "@playwright/test";

const API = "http://127.0.0.1:8787";
const emptyStorage = { cookies: [], origins: [] };

test.describe("public & marketing", () => {
  test.use({ storageState: emptyStorage });

  test("landing / has brand and primary CTAs", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("navigation")).toBeVisible();
    await expect(page.getByRole("link", { name: /Sign in/i }).first()).toBeVisible();
  });

  test("pricing /pricing shows plan content", async ({ page }) => {
    await page.goto("/pricing");
    await expect(page.getByText(/Pricing/i).first()).toBeVisible();
    await expect(page.getByText(/Team/i).first()).toBeVisible();
  });

  test("public badge demo /badge renders certification record chrome", async ({ page }) => {
    await page.goto("/badge");
    await expect(page.getByText(/Certification Record/i).first()).toBeVisible();
    await expect(page.getByText(/Embeddable badges/i)).toBeVisible();
  });

  test("forgot-password page loads", async ({ page }) => {
    await page.goto("/forgot-password");
    await expect(page.getByRole("button", { name: /Send reset link|Reset password/i })).toBeVisible();
  });

  test("reset-password page loads", async ({ page }) => {
    await page.goto("/reset-password?token=test-token");
    await expect(page.getByRole("button", { name: /Update password/i })).toBeVisible();
  });
});

test.describe("auth redirects (unauthenticated)", () => {
  test.use({ storageState: emptyStorage });

  test("protected routes redirect to /login", async ({ page }) => {
    for (const path of ["/releases", "/settings", "/intelligence", "/emails"]) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/login$/);
    }
  });

  test("invalid JWT is cleared and user sent to login", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("vdk3_auth_token", "not-a-real-jwt");
      localStorage.setItem("vdk3_currentUser", JSON.stringify({ id: "x" }));
    });
    await page.goto("/releases");
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("authenticated app shell", () => {
  test("valid session reaches dashboard content", async ({ page }) => {
    await page.goto("/releases");
    await expect(page.getByText(/Verifying session/i)).toBeHidden({ timeout: 25_000 });
    await expect(page).not.toHaveURL(/\/login$/);
    await expect(page.locator("body")).toContainText(/RELEASE CANDIDATES|No releases yet|Release|SETUP CHECKLIST|Verdikt/i);
  });

  test("dashboard primary nav destinations load", async ({ page }) => {
    const routes = [
      ["/releases", /RELEASE CANDIDATES|No releases yet|SETUP CHECKLIST|Verdikt/i],
      ["/trends", /Signal Trend/i],
      ["/thresholds", /Thresholds/i],
      ["/audit", /Audit Trail/i]
    ];
    for (const [path, re] of routes) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(path.replace("/", "\\/") + "$"));
      await expect(page.locator("body")).toContainText(re);
    }
  });

  test("Intelligence Hub /intelligence", async ({ page }) => {
    await page.goto("/intelligence");
    await expect(page).toHaveURL(/\/intelligence$/);
    await expect(page.getByText(/Intelligence/i).first()).toBeVisible();
    await expect(page.getByText(/Hub/i).first()).toBeVisible();
  });

  test("email previews /emails", async ({ page }) => {
    await page.goto("/emails");
    await expect(page).toHaveURL(/\/emails$/);
    await expect(
      page.getByText(/Preview only|templates ship as HTML|EMAIL NOTIFICATIONS/i).first()
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Copy HTML/i })).toBeVisible();
  });

  test("settings sections via ?section= query", async ({ page }) => {
    const cases = [
      ["general", /General/i],
      ["governance", /Governance/i],
      ["team", /Team|Roles/i],
      ["thresholds", /Threshold|Quality/i],
      ["api", /API|Signal/i],
      ["trigger", /Trigger|Release/i],
      ["notifications", /Notification/i],
      ["emails", /Email|Preview/i],
      ["billing", /Plan|Billing|Pricing/i],
      ["danger", /Danger|Delete|Export/i]
    ];
    for (const [section, textRe] of cases) {
      await page.goto(`/settings?section=${section}`);
      await expect(page).toHaveURL(new RegExp(`/settings\\?section=${section}`));
      await expect(page.locator("body")).toContainText(textRe);
    }
  });
});

test.describe("login form interaction", () => {
  test.use({ storageState: emptyStorage });

  test("demo credentials reach authenticated shell", async ({ page }) => {
    await page.goto("/login");
    await page.locator("#login-email").fill("demo@verdikt.local");
    await page.locator("#login-password").fill("demo123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/releases$/, { timeout: 20_000 });
    await expect(page.locator("body")).toContainText(
      /RELEASE CANDIDATES|No releases yet|SETUP CHECKLIST|Verdikt/i
    );
  });
});

test.describe("API health (e2e environment)", () => {
  test("backend health", async ({ request }) => {
    const res = await request.get(`${API}/health`);
    expect(res.ok()).toBeTruthy();
    expect(await res.text()).toContain("verdikt-backend");
  });
});
