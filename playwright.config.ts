import { defineConfig, devices } from "@playwright/test";

// Playwright/Next can set FORCE_COLOR for child processes; NO_COLOR then causes noisy Node warnings.
delete process.env.NO_COLOR;

const host = process.env.E2E_HOST ?? "127.0.0.1";
const port = process.env.E2E_PORT ?? "3070";
const baseURL = process.env.E2E_BASE_URL ?? `http://${host}:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: [
    /deploy-smoke\.spec\.ts/,
    /student-local\.spec\.ts/
  ],
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  webServer: {
    command: "node scripts/e2e-server.mjs",
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      E2E_HOST: host,
      E2E_PORT: port,
      E2E_BASE_URL: baseURL,
      E2E_DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgres://michaelwelsch@127.0.0.1:55432/learnbuddy_e2e_smoke"
    }
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
