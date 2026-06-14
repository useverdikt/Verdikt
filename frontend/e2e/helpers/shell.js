import { expect } from "@playwright/test";

/** Text that indicates the authenticated releases shell has loaded (redesign-safe). */
export const AUTHENTICATED_SHELL_RE =
  /Releases|Release history|Release Signals|No releases yet|Setup checklist|Verdikt/i;

export async function waitForSessionGate(page) {
  await expect(page.getByText(/Verifying session/i)).toBeHidden({ timeout: 25_000 });
}

/** Wait until the releases table has at least one row (post workspace sync). */
export async function waitForReleaseRows(page, { timeout = 25_000 } = {}) {
  await waitForSessionGate(page);
  await expect(page.locator(".release-row").first()).toBeVisible({ timeout });
}

/** Primary dashboard CTA (avoids strict-mode clash with sidebar duplicate). */
export function newReleaseButton(page) {
  return page.locator(".btn-new");
}
