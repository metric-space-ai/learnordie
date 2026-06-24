import { defineConfig, devices } from "@playwright/test";

delete process.env.NO_COLOR;

const host = process.env.SLIDE_ENGINE_QA_HOST ?? "127.0.0.1";
const port = process.env.SLIDE_ENGINE_QA_PORT ?? "3098";
const baseURL = process.env.SLIDE_ENGINE_QA_BASE_URL ?? `http://${host}:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /slide-engine-qa\.spec\.ts/,
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  webServer: {
    command: `npm run dev -- --hostname ${host} --port ${port}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
    env: {
      LEARNBUDDY_REPOSITORY: "local"
    }
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
