import { defineConfig, devices } from "@playwright/test";

// Lightweight config for the student/lecturer product flows against an isolated LOCAL-store.
delete process.env.NO_COLOR;

const baseURL = process.env.LOCAL_E2E_BASE_URL ?? "http://localhost:3099";
const serverUrl = new URL(baseURL);

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /(student-local|lecturer-engine-local)\.spec\.ts/,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL,
    trace: "off",
    screenshot: "only-on-failure",
    video: "off"
  },
  webServer: {
    command: `npm run dev -- --hostname ${serverUrl.hostname} --port ${serverUrl.port || "3099"}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      LEARNBUDDY_REPOSITORY: "local",
      LEARNBUDDY_LOCAL_STORE_PATH: `.tmp/learnbuddy-local-e2e-${process.pid}.json`,
      LEARNBUDDY_AI_PROVIDER: "demo",
      LEARNBUDDY_QUESTION_GENERATOR: "local",
      LEARNBUDDY_MAIL_PROVIDER: "console"
    }
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }]
});
