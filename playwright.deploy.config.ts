import { defineConfig, devices } from "@playwright/test";

// Smoke a DEPLOYED preview (Postgres-backed). No webServer — targets a live URL.
delete process.env.NO_COLOR;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /deploy-smoke\.spec\.ts/,
  timeout: 120_000,
  expect: { timeout: 25_000 },
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: "list",
  use: {
    baseURL: process.env.DEPLOY_SMOKE_URL ?? "http://localhost:3099",
    trace: "off",
    screenshot: "only-on-failure",
    video: "off"
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
