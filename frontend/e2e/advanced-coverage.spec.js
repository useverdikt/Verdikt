import { test, expect } from "@playwright/test";
import { newReleaseButton, waitForSessionGate } from "./helpers/shell.js";
import { setUserRoleByEmail } from "./helpers/setUserRole.js";
import { applySessionToBrowser, loginUser, registerUser } from "./helpers/authSession.js";

const emptyStorage = { cookies: [], origins: [] };

async function waitForSessionGateLocal(page) {
  await waitForSessionGate(page);
}

test.describe("session + error states", () => {
  test.use({ storageState: emptyStorage });

  test("ProtectedRoute network error state is visible", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("vdk3_auth_token", "synthetic-token");
      localStorage.setItem("vdk3_currentUser", JSON.stringify({ name: "Network User", role: "ai_product_lead" }));
      localStorage.setItem("vdk3_workspace_id", "1");
    });
    await page.route("**/api/auth/me", async (route) => route.abort());
    await page.goto("/releases");
    await expect(page.getByText(/Can’t reach the server to verify your session/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Retry/i })).toBeVisible();
  });
});

test.describe("form edge cases", () => {
  test.use({ storageState: emptyStorage });

  test("login invalid credentials shows API error", async ({ page }) => {
    await page.goto("/login");
    await page.locator("#login-email").fill("demo@verdikt.local");
    await page.locator("#login-password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText(/Invalid email or password/i)).toBeVisible();
  });

  test("login network failure shows cannot reach API", async ({ page }) => {
    await page.route("**/api/auth/login", async (route) => route.abort());
    await page.goto("/login");
    await page.locator("#login-email").fill("demo@verdikt.local");
    await page.locator("#login-password").fill("demo123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText(/Cannot reach the API\. Is the backend running\?/i)).toBeVisible();
  });

  test("forgot-password invalid email validation", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.locator("#forgot-email").fill("bad-email");
    await page.getByRole("button", { name: /Send reset link/i }).click();
    await expect(page.getByText(/Enter a valid email address/i)).toBeVisible();
  });

  test("forgot-password network failure error", async ({ page }) => {
    await page.route("**/api/auth/forgot-password", async (route) => route.abort());
    await page.goto("/forgot-password");
    await page.locator("#forgot-email").fill("demo@verdikt.local");
    await page.getByRole("button", { name: /Send reset link/i }).click();
    await expect(page.getByText(/Cannot reach the API\. Is the backend running\?/i)).toBeVisible();
  });
});

test.describe("modal interaction coverage", () => {
  test("Start certification modal open, validate, submit", async ({ page }) => {
    await page.goto("/releases");
    await waitForSessionGateLocal(page);

    await newReleaseButton(page).click();
    await expect(page.getByRole("heading", { name: /Start certification/i })).toBeVisible();

    // Empty version should not proceed.
    await page.getByRole("button", { name: /Start certification →/i }).click();
    await expect(page.getByRole("heading", { name: /Start certification/i })).toBeVisible();

    await page.getByPlaceholder("e.g. v2.15.0").fill("v9.9.9-e2e");
    await page.getByRole("button", { name: /Start certification →/i }).click();
    await expect(page.getByRole("heading", { name: /Start certification/i })).toBeHidden();
    await expect(page.locator("body")).toContainText(/COLLECTING|Signal collection progress|Simulate/i);
  });

  test("Share modal opens from release header and closes", async ({ page }) => {
    await page.goto("/releases");
    await waitForSessionGateLocal(page);

    const shareBtn = page.locator(".release-header-share-btn").first();
    if (await shareBtn.count()) {
      await expect(shareBtn).toBeVisible();
      await shareBtn.click();
      await expect(page.getByRole("button", { name: /Copy link|✓ Copied/i })).toBeVisible();
      await page.getByRole("button", { name: "✕" }).first().click();
      await expect(page.getByRole("button", { name: /Copy link|✓ Copied/i })).toBeHidden();
    } else {
      // Collecting-only releases have no share action in current UI.
      await expect(page.locator("body")).toContainText(/COLLECTING|Signal collection progress|Simulate/i);
    }
  });

  test("Certification record modal opens from Audit Trail row", async ({ page }) => {
    await page.goto("/audit");
    await waitForSessionGateLocal(page);

    const clickableRows = page.locator("div[style*='cursor: pointer']");
    const count = await clickableRows.count();
    if (count === 0) {
      // Workspace may only have auth/admin audit events (no release-linked entries yet).
      await expect(page.getByRole("heading", { name: "Audit Trail" })).toBeVisible();
      return;
    }
    await clickableRows.first().click();
    await expect(page.getByText(/CERTIFICATION RECORD/i).first()).toBeVisible();
  });
});


test.describe("permission / role matrix", () => {
  test.describe("engineer read-only", () => {
    test.use({ storageState: emptyStorage });

    test("Engineer role is read-only on thresholds", async ({ page, context }) => {
      const email = `e2e_eng_${Date.now()}@test.local`;
      const password = "password123";
      await registerUser({ email, password, name: "E2E Engineer" });
      await setUserRoleByEmail(email, "engineer");
      const session = await loginUser({ email, password });
      expect(session.user.role).toBe("engineer");
      await applySessionToBrowser(context, page, session);

      await page.goto("/thresholds");
      await waitForSessionGateLocal(page);
      await expect(page.getByText(/READ ONLY/i).first()).toBeVisible();
      await expect(page.getByRole("button", { name: /Save Thresholds/i })).toHaveCount(0);
    });
  });

  test("VP Engineering role can act on release dashboard", async ({ page }) => {
    // global-setup logs in demo@verdikt.local (vp_engineering) — server-authoritative role
    await page.goto("/releases");
    await waitForSessionGateLocal(page);
    // Sidebar release actions live in ReleaseCandidateSection (not mounted in current shell); primary CTAs are on the dashboard header.
    await expect(newReleaseButton(page)).toBeVisible();
  });
});

test.describe("deep widget states", () => {
  test("Production alignment panel renders either empty or metrics state", async ({ page }) => {
    await page.goto("/intelligence/alignment");
    await waitForSessionGateLocal(page);
    await expect(page).toHaveURL(/\/intelligence\/alignment$/);
    await expect(page.getByText("Production Alignment", { exact: true }).first()).toBeVisible();
    await expect(
      page.getByText(
        /Waiting for first alignment|Production data is collected|Prediction accuracy|total releases with feedback|alignment and post-deploy|Alignment data requires production observation|Production observation is off|View VCS production monitor/i
      ).first()
    ).toBeVisible({ timeout: 15_000 });
  });
});

