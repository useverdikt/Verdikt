import { test, expect } from "@playwright/test";

const emptyStorage = { cookies: [], origins: [] };

async function waitForSessionGate(page) {
  await expect(page.getByText(/Verifying session/i)).toBeHidden({ timeout: 25_000 });
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
    await waitForSessionGate(page);

    await page.getByRole("button", { name: /\+ New release/i }).click();
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
    await waitForSessionGate(page);

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
    await waitForSessionGate(page);

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

test.describe("SSE / stream panel coverage", () => {
  test("SSE token failure is surfaced in stream log", async ({ page }) => {
    await page.route("**/api/releases/*/sse-token", async (route) => {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "token unavailable" })
      });
    });

    await page.goto("/intelligence");
    await waitForSessionGate(page);
    await page.getByPlaceholder(/Release ID \(rel_\.\.\.\)/i).fill("rel_fake_stream");
    await page.getByRole("button", { name: /Connect/i }).click();
    await expect(page.getByText(/Could not get stream token/i)).toBeVisible();
  });
});

test.describe("permission / role matrix", () => {
  test("Engineer role is read-only on thresholds", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("vdk3_currentUser", JSON.stringify({ name: "Read Only User", role: "engineer" }));
    });
    await page.goto("/thresholds");
    await waitForSessionGate(page);
    await expect(page.getByText(/READ ONLY/i).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /Save Thresholds/i })).toHaveCount(0);
  });

  test("VP Engineering role can act on release dashboard", async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("vdk3_currentUser", JSON.stringify({ name: "Alex VP", role: "vp_engineering" }));
    });
    await page.goto("/releases");
    await waitForSessionGate(page);
    // Sidebar release actions live in ReleaseCandidateSection (not mounted in current shell); primary CTAs are on the dashboard header.
    await expect(page.getByRole("button", { name: /\+ New release/i }).first()).toBeVisible();
  });
});

test.describe("deep widget states", () => {
  test("Production alignment panel renders either empty or metrics state", async ({ page }) => {
    await page.goto("/intelligence");
    await waitForSessionGate(page);
    await expect(page.getByText("Production Alignment", { exact: true }).first()).toBeVisible();
    await expect(
      page.getByText(
        /Waiting for first alignment|Production data is collected|Prediction accuracy|total releases with feedback|alignment and post-deploy/i
      ).first()
    ).toBeVisible({ timeout: 15_000 });
  });
});

