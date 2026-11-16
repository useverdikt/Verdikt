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

  test("request-access form keeps submit disabled until required fields are present", async ({ page }) => {
    await page.goto("/request-access");
    await expect(page.getByText(/Join the waitlist|Get on the list/i).first()).toBeVisible();
    const submit = page.getByRole("button", { name: /^Send request$/i });
    await expect(submit).toBeVisible();
    await expect(submit).toBeDisabled();
    await expect(page.locator('input[type="email"]').first()).toBeVisible();
  });

  test("EU AI Act mapping page states it is not a compliance guarantee", async ({ page }) => {
    await page.goto("/eu-ai-act");
    await expect(page.getByRole("heading", { name: /Verdikt and the EU AI Act/i })).toBeVisible();
    await expect(page.getByText(/not a compliance guarantee/i).first()).toBeVisible();
  });
});
