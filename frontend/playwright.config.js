import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const frontendDir = path.dirname(fileURLToPath(import.meta.url));
const storageState = path.join(frontendDir, "e2e/.auth/storage.json");

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  globalSetup: path.join(frontendDir, "e2e/global-setup.js"),
  use: {
    baseURL: "http://127.0.0.1:5174",
    trace: "on-first-retry",
    storageState
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      'concurrently -k -n api,vite -c cyan,magenta "npm run start --prefix ../backend" "npm run dev"',
    cwd: frontendDir,
    url: "http://127.0.0.1:5174",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000
  }
});
