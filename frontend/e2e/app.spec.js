/**
 * Thin public-route checks that are not duplicated in full-coverage.
 * Prefer journey specs (cert-gate-smoke, escalations, regression) for behaviour.
 */
import { test, expect } from "@playwright/test";

const emptyStorage = { cookies: [], origins: [] };

test.describe("public routes", () => {
  test.use({ storageState: emptyStorage });

  test("login page links to forgot password", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("link", { name: /^Forgot\?$/i }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await expect(page.getByRole("button", { name: /Send reset link|Reset password/i })).toBeVisible();
  });

  test("request-access form is submittable", async ({ page }) => {
    await page.goto("/request-access");
    await expect(page.getByRole("heading", { name: /Get on the list for/i })).toBeVisible();
    const email = page.getByLabel(/email/i).or(page.locator('input[type="email"]')).first();
    await expect(email).toBeVisible();
    await email.fill(`e2e-waitlist-${Date.now()}@example.com`);
    const submit = page.getByRole("button", { name: /join|request|submit|get on/i }).first();
    await expect(submit).toBeVisible();
    await submit.click();
    await expect(
      page.getByText(/thanks|you're on|on the list|check your email|received|submitted/i).first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test("EU AI Act mapping page states it is not a compliance guarantee", async ({ page }) => {
    await page.goto("/eu-ai-act");
    await expect(page.getByRole("heading", { name: /Verdikt and the EU AI Act/i })).toBeVisible();
    await expect(page.getByText(/not a compliance guarantee/i).first()).toBeVisible();
  });
});
