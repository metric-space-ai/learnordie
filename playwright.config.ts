import { defineConfig, devices } from "@playwright/test";

// Playwright/Next can set FORCE_COLOR for child processes; NO_COLOR then causes noisy Node warnings.
delete process.env.NO_COLOR;

const host = process.env.E2E_HOST ?? "127.0.0.1";
const port = process.env.E2E_PORT ?? "3070";
const baseURL = process.env.E2E_BASE_URL ?? `http://${host}:${port}`;
const evidenceScope = process.env.E2E_EVIDENCE_SCOPE === "student-draft-races" ? "student-draft-races" : null;
const outputDir = evidenceScope ? `test-results/${evidenceScope}` : "test-results";
const htmlOutputFolder = evidenceScope ? `playwright-report/${evidenceScope}` : "playwright-report";

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir,
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
  // Stop a broken release quickly; a passing gate still runs the entire suite.
  maxFailures: process.env.CI ? 6 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never", outputFolder: htmlOutputFolder }], ["json", { outputFile: `${outputDir}/results.json` }]] : "list",
  use: {
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
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
      E2E_DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgres://michaelwelsch@127.0.0.1:55432/learnbuddy_e2e_smoke",
      LEARNBUDDY_CHAT_QUESTION_LIMIT_PER_WINDOW: process.env.LEARNBUDDY_CHAT_QUESTION_LIMIT_PER_WINDOW ?? "3",
      E2E_AI_MOCK_PORT: process.env.E2E_AI_MOCK_PORT ?? "4070",
      E2E_AI_PROVIDER: process.env.E2E_AI_PROVIDER ?? "",
      E2E_STUDENT_DRAFT_DELAY_MS: process.env.E2E_STUDENT_DRAFT_DELAY_MS ?? "0",
      E2E_STUDENT_DRAFT_DELAY_MARKER: process.env.E2E_STUDENT_DRAFT_DELAY_MARKER ?? "",
      E2E_PRESERVE_DATABASE: process.env.E2E_PRESERVE_DATABASE ?? "0",
      E2E_SKIP_MIGRATIONS: process.env.E2E_SKIP_MIGRATIONS ?? "0"
    }
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
