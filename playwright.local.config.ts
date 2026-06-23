import { defineConfig, devices } from "@playwright/test";

// Lightweight config for the student/lecturer product flows against a LOCAL-store
// dev server (no Postgres). Assumes a server is already running at LOCAL_E2E_BASE_URL
// (default http://localhost:3099). Run: npx playwright test --config playwright.local.config.ts
delete process.env.NO_COLOR;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /student-local\.spec\.ts/,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: process.env.LOCAL_E2E_BASE_URL ?? "http://localhost:3099",
    trace: "off",
    screenshot: "only-on-failure",
    video: "off"
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
