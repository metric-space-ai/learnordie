import { execFile, spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { expect, type Browser, type Page, test } from "@playwright/test";
import postgres from "postgres";

import { audioFileExtension, encodePcm16Wav } from "../../src/lib/audio-capture";

const execFileAsync = promisify(execFile);
const e2eDatabaseUrl = process.env.E2E_DATABASE_URL ?? "postgres://michaelwelsch@127.0.0.1:55432/learnbuddy_e2e_smoke";
const e2eAuthSecret = "learnbuddy-e2e-secret-with-more-than-32-characters";
const lecturerSessionCookie = "lb_lecturer_session";
const e2eBaseUrl = process.env.E2E_BASE_URL ?? `http://${process.env.E2E_HOST ?? "127.0.0.1"}:${process.env.E2E_PORT ?? "3070"}`;
const e2eBaseOrigin = new URL(e2eBaseUrl).origin;

function attachBrowserDiagnostics(page: Page) {
  const problems: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) {
      problems.push(`console:${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    problems.push(`pageerror:${error.message}`);
  });
  page.on("requestfailed", (request) => {
    const errorText = request.failure()?.errorText ?? "";
    if (errorText === "net::ERR_ABORTED") return;
    problems.push(`requestfailed:${request.method()} ${request.url()} ${errorText}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 500) {
      problems.push(`response:${response.status()} ${response.url()}`);
    }
  });

  return () => expect(problems, problems.join("\n")).toEqual([]);
}

async function requestMagicLink(page: Page, email = "e2e@example.test") {
  await page.goto("/lecturer/login");
  await page.getByLabel("E-Mail").fill(email);
  await page.getByRole("button", { name: "Magic Link senden" }).click();
  const href = await page.getByRole("link", { name: "Referentenbereich öffnen" }).getAttribute("href");
  if (!href) throw new Error("Magic link was not rendered in local mail mode.");
  return new URL(href, page.url()).toString();
}

async function loginLecturer(page: Page) {
  const magicLink = await requestMagicLink(page);
  await page.goto(magicLink);
  await expect(page).toHaveURL(/\/lecturer$/);
  await expect(page.getByRole("textbox", { name: "Folientitel" })).toContainText("Hydrodynamische Gleitlagerung");
  return magicLink;
}

async function lecturerCsrfToken(page: Page) {
  const token = await page.locator("[data-csrf-token]").first().getAttribute("data-csrf-token");
  if (!token) throw new Error("Lecturer CSRF token was not rendered.");
  return token;
}

async function expectMagicLinkCannotBeReused(browser: Browser, magicLink: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(magicLink);
    await expect(page).toHaveURL(/\/lecturer\/login\?error=invalid-token$/);
    await expect(page.getByText("Dieser Magic Link ist abgelaufen oder wurde bereits verwendet.")).toBeVisible();
  } finally {
    await context.close();
  }
}

function signTestPayload(payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", e2eAuthSecret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

function decodeTestPayload<T>(token: string): T {
  return JSON.parse(Buffer.from(token.split(".")[0] ?? "", "base64url").toString("utf8")) as T;
}

async function startStorageReadTrap() {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    response.writeHead(200, { "content-type": "audio/wav" });
    response.end("not a real lecture artifact");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Storage read trap did not expose a TCP address.");
  }

  return {
    url: `http://127.0.0.1:${(address as AddressInfo).port}/audio.wav`,
    requestCount: () => requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    })
  };
}

async function startDuplicateQuestionGeneratorMock() {
  const duplicateQuestion = {
    level: "4.0",
    text: "Welche Aussage beschreibt die hydrodynamische Gleitlagerung?",
    answers: [
      { text: "Relativbewegung und Keilspalt bauen einen Schmierfilm auf.", correct: true },
      { text: "Festkörperkontakt ist das gewünschte Dauerbetriebsziel.", correct: false },
      { text: "Schmierstoff wird entfernt, damit Mischreibung verschwindet.", correct: false },
      { text: "Das Lagerspiel wird beliebig klein gewählt.", correct: false }
    ],
    explanation: "Diese Erklärung ist absichtlich für den Duplicate-Guard gedoppelt."
  };

  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not found" }));
      return;
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            variants: ["4.0", "3.0", "2.0", "1.0"].map((level) => ({
              ...duplicateQuestion,
              level
            }))
          })
        }
      }],
      usage: {
        prompt_tokens: 12,
        completion_tokens: 12,
        total_tokens: 24
      }
    }));
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Question generator mock did not expose a TCP address.");
  }

  return {
    url: `http://127.0.0.1:${(address as AddressInfo).port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    })
  };
}

async function freeTcpPort() {
  const server = createServer((_request, response) => {
    response.writeHead(204);
    response.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Free port probe did not expose a TCP address.");
  }
  const port = (address as AddressInfo).port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
  return port;
}

async function stopChild(child: ChildProcess) {
  if (child.exitCode !== null || child.killed) return;

  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 3_000))
  ]);

  if (child.exitCode === null && !child.killed) {
    child.kill("SIGKILL");
  }
}

async function startIsolatedNextServer(extraEnv: Record<string, string>) {
  const port = await freeTcpPort();
  const url = `http://127.0.0.1:${port}`;
  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  const child = spawn(process.execPath, [nextBin, "start", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: e2eDatabaseUrl,
      NEXT_PUBLIC_APP_URL: "https://learnbuddy.cloud",
      AUTH_SECRET: e2eAuthSecret,
      LEARNBUDDY_REPOSITORY: "postgres",
      LEARNBUDDY_AUTO_SEED: "0",
      ...extraEnv
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let logs = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    logs += chunk.toString("utf8");
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    logs += chunk.toString("utf8");
  });

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Isolated next start exited with ${child.exitCode}:\n${logs}`);
    }

    try {
      const response = await fetch(`${url}/api/health`);
      if (response.ok) {
        return {
          url,
          close: () => stopChild(child)
        };
      }
    } catch {
      // Keep polling until next start is ready or exits.
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }

  await stopChild(child);
  throw new Error(`Isolated next start did not become ready:\n${logs}`);
}

async function expectExpiredSessionCookieIsRejected(page: Page) {
  const expiredAt = Date.now() - 1000;
  await page.context().addCookies([{
    name: lecturerSessionCookie,
    value: signTestPayload({
      email: "e2e@example.test",
      issuedAt: new Date(expiredAt - 60 * 60 * 1000).toISOString(),
      expiresAt: expiredAt
    }),
    url: page.url(),
    httpOnly: true,
    sameSite: "Lax",
    expires: Math.floor(Date.now() / 1000) + 3600
  }]);

  await page.goto("/lecturer");
  await expect(page).toHaveURL(/\/lecturer\/login$/);
}

async function setRangeValue(page: Page, selector: string, value: string) {
  await page.locator(selector).evaluate((element, nextValue) => {
    if (!(element instanceof HTMLInputElement)) throw new Error(`${selector} is not an input.`);
    element.value = nextValue;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

async function seedLiveLeaderboardLoad(page: Page, runId: string) {
  const levelsByPoints: Record<number, string> = {
    1: "4.0",
    2: "3.0",
    3: "2.0",
    4: "1.0"
  };
  const correctKeyByLevel: Record<string, string> = {
    "4.0": "B",
    "3.0": "A",
    "2.0": "B",
    "1.0": "A"
  };
  const participants = Array.from({ length: 30 }, (_, index) => {
    const rank = index + 1;
    return {
      anonymousKey: `load-${runId}-${String(rank).padStart(2, "0")}`,
      pseudonym: `Load ${String(rank).padStart(2, "0")}`,
      answerCount: rank === 1 ? 3 : rank === 2 ? 2 : 1,
      points: rank <= 2 ? 4 : ((rank - 1) % 4) + 1
    };
  });

  await Promise.all(participants.map(async (participant) => {
    for (let answerIndex = 0; answerIndex < participant.answerCount; answerIndex += 1) {
      const response = await page.request.post("/api/events", {
        data: {
          lectureToken: "gleitlagerung-demo",
          eventType: "answer_selected",
          anonymousKey: participant.anonymousKey,
          pseudonym: participant.pseudonym,
          payload: {
            mode: "live",
            level: levelsByPoints[participant.points],
            points: participant.points,
            questionText: `30er Live-Smoke ${runId}: Mischreibung`,
            selected: correctKeyByLevel[levelsByPoints[participant.points]],
            selectedAnswerKey: correctKeyByLevel[levelsByPoints[participant.points]],
            selectedAnswerText: "Startphase entlasten oder zusätzliche Schmierfilmversorgung vorsehen.",
            correctAnswerKey: correctKeyByLevel[levelsByPoints[participant.points]],
            correctAnswerText: "Startphase entlasten oder zusätzliche Schmierfilmversorgung vorsehen.",
            correct: true,
            smokeRunId: runId,
            answerIndex
          }
        }
      });
      expect(response.ok()).toBe(true);
      const payload = await response.json() as { ok?: boolean };
      expect(payload.ok).toBe(true);
    }
  }));

  return participants;
}

async function runAdminCommand(args: string[]) {
  const result = await execFileAsync(process.execPath, ["scripts/admin.mjs", ...args], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: e2eDatabaseUrl
    },
    timeout: 30_000
  });
  return JSON.parse(result.stdout) as {
    ok: boolean;
    applied?: boolean;
    policy?: {
      schemaVersion?: string;
      pseudonymousLearningSignals?: {
        years?: number;
        cleanupAction?: string;
        autoCleanup?: boolean;
      };
      courseContent?: {
        retentionClass?: string;
        autoCleanup?: boolean;
      };
      standaloneArtifacts?: {
        retentionClass?: string;
        minimumYears?: number;
        autoCleanup?: boolean;
      };
      qualityAggregates?: {
        retentionClass?: string;
        minimumYears?: number;
      };
    };
    cleanupTotal?: number;
    contentTotal?: number;
    touchedTotal?: number;
    affected?: Record<string, number>;
    skippedContent?: Record<string, number>;
    counts?: Record<string, number>;
  };
}

async function runAdminCommandAllowFailure(args: string[], extraEnv: Record<string, string>) {
  try {
    const result = await execFileAsync(process.execPath, ["scripts/admin.mjs", ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: e2eDatabaseUrl,
        ...extraEnv
      },
      timeout: 30_000
    });
    return JSON.parse(result.stdout) as {
      ok: boolean;
      checks?: Array<{ id?: string; status?: string; severity?: string; message?: string }>;
      blockers?: Array<{ id?: string; status?: string; severity?: string; message?: string; details?: Record<string, unknown> }>;
    };
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout;
    if (!stdout) throw error;
    return JSON.parse(stdout) as {
      ok: boolean;
      checks?: Array<{ id?: string; status?: string; severity?: string; message?: string }>;
      blockers?: Array<{ id?: string; status?: string; severity?: string; message?: string; details?: Record<string, unknown> }>;
    };
  }
}

async function runProviderSmokeAllowFailure(args: string[], extraEnv: Record<string, string>) {
  try {
    const result = await execFileAsync(process.execPath, ["scripts/provider-smoke.mjs", ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...extraEnv
      },
      timeout: 30_000
    });
    return JSON.parse(result.stdout) as {
      ok: boolean;
      checks?: Array<{ id?: string; status?: string; message?: string; details?: Record<string, unknown> }>;
      blockers?: Array<{ id?: string; status?: string; message?: string; details?: Record<string, unknown> }>;
    };
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout;
    if (!stdout) throw error;
    return JSON.parse(stdout) as {
      ok: boolean;
      checks?: Array<{ id?: string; status?: string; message?: string; details?: Record<string, unknown> }>;
      blockers?: Array<{ id?: string; status?: string; message?: string; details?: Record<string, unknown> }>;
    };
  }
}

type ReleaseGateBlocker = {
  id?: string;
  status?: string;
  message?: string;
  details?: {
    childChecks?: Array<{
      id?: string;
      status?: string;
      severity?: string;
      message?: string;
      details?: Record<string, unknown>;
    }>;
  } & Record<string, unknown>;
};

type DeployReadinessBlocker = {
  id?: string;
  status?: string;
  message?: string;
  details?: Record<string, unknown>;
};

async function runReleaseGateAllowFailure(args: string[], extraEnv: Record<string, string> = {}) {
  try {
    const result = await execFileAsync(process.execPath, ["scripts/release-gate.mjs", ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...extraEnv
      },
      timeout: 30_000
    });
    return JSON.parse(result.stdout) as {
      ok: boolean;
      releaseReady?: boolean;
      productionReady?: boolean;
      target?: string;
      checks?: Array<{ id?: string; status?: string; message?: string; details?: Record<string, unknown> }>;
      blockers?: ReleaseGateBlocker[];
    };
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout;
    if (!stdout) throw error;
    return JSON.parse(stdout) as {
      ok: boolean;
      releaseReady?: boolean;
      productionReady?: boolean;
      target?: string;
      checks?: Array<{ id?: string; status?: string; message?: string; details?: Record<string, unknown> }>;
      blockers?: ReleaseGateBlocker[];
    };
  }
}

async function runDeployReadinessAllowFailure(args: string[], extraEnv: Record<string, string>) {
  try {
    const result = await execFileAsync(process.execPath, ["scripts/deploy-readiness.mjs", ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...extraEnv
      },
      timeout: 30_000
    });
    return JSON.parse(result.stdout) as {
      ok: boolean;
      target?: string;
      checks?: Array<{ id?: string; status?: string; message?: string }>;
      blockers?: DeployReadinessBlocker[];
    };
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout;
    if (!stdout) throw error;
    return JSON.parse(stdout) as {
      ok: boolean;
      target?: string;
      checks?: Array<{ id?: string; status?: string; message?: string; details?: Record<string, unknown> }>;
      blockers?: DeployReadinessBlocker[];
    };
  }
}

async function runDeployReadinessWithExactEnvAllowFailure(args: string[], exactEnv: Record<string, string>) {
  try {
    const result = await execFileAsync(process.execPath, ["scripts/deploy-readiness.mjs", ...args], {
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        NODE_ENV: process.env.NODE_ENV ?? "test",
        ...exactEnv
      },
      timeout: 30_000
    });
    return JSON.parse(result.stdout) as {
      ok: boolean;
      target?: string;
      checks?: Array<{ id?: string; status?: string; message?: string; details?: Record<string, unknown> }>;
      blockers?: DeployReadinessBlocker[];
    };
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout;
    if (!stdout) throw error;
    return JSON.parse(stdout) as {
      ok: boolean;
      target?: string;
      checks?: Array<{ id?: string; status?: string; message?: string; details?: Record<string, unknown> }>;
      blockers?: DeployReadinessBlocker[];
    };
  }
}

async function withTemporaryVercelProjectLink<T>(callback: () => Promise<T>) {
  const projectDir = path.join(process.cwd(), ".vercel");
  const projectPath = path.join(projectDir, "project.json");
  let previousContent: string | null = null;
  try {
    previousContent = await readFile(projectPath, "utf8");
  } catch {
    previousContent = null;
  }

  await mkdir(projectDir, { recursive: true });
  await writeFile(projectPath, JSON.stringify({
    projectId: "prj_e2e_deploy_readiness",
    orgId: "team_e2e_deploy_readiness"
  }), "utf8");

  try {
    return await callback();
  } finally {
    if (previousContent === null) {
      await rm(projectPath, { force: true });
    } else {
      await writeFile(projectPath, previousContent, "utf8");
    }
  }
}

async function createFakeVercelCli(envContent: string) {
  const fakeRoot = path.join(process.cwd(), "output", `fake-vercel-${crypto.randomUUID()}`);
  const binDir = path.join(fakeRoot, "bin");
  const vercelPath = path.join(binDir, "vercel");
  const envNames = envContent
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Za-z_][A-Za-z0-9_]*)=/)?.[1])
    .filter(Boolean);
  await mkdir(binDir, { recursive: true });
  await writeFile(vercelPath, `#!/usr/bin/env node
const fs = require("node:fs");
const args = process.argv.slice(2);
if (args[0] === "--version") {
  console.log("Vercel CLI 99.0.0-test");
  process.exit(0);
}
if (args[0] === "whoami") {
  console.log("learnbuddy-e2e");
  process.exit(0);
}
if (args[0] === "env" && args[1] === "list") {
  const environment = args[2] || "";
  const envs = environment === "production"
    ? ${JSON.stringify(envNames)}.map((key) => ({ key }))
    : [];
  console.log(JSON.stringify({ envs }));
  process.exit(0);
}
if (args[0] === "env" && args[1] === "pull") {
  fs.writeFileSync(args[2], ${JSON.stringify(envContent)});
  console.log("Pulled");
  process.exit(0);
}
console.error("Unexpected fake vercel invocation: " + args.join(" "));
process.exit(2);
`, { mode: 0o755 });
  return {
    binDir,
    cleanup: () => rm(fakeRoot, { recursive: true, force: true })
  };
}

async function createFakeNpmCli() {
  const fakeRoot = path.join(process.cwd(), "output", `fake-npm-${crypto.randomUUID()}`);
  const binDir = path.join(fakeRoot, "bin");
  const npmPath = path.join(binDir, "npm");
  await mkdir(binDir, { recursive: true });
  await writeFile(npmPath, `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args[0] === "run" && args[1] === "scripts:check") {
  console.log("script syntax passed but no JSON was emitted");
  process.exit(0);
}
if (args[0] === "run" && args[1] === "smoke:backup-restore") {
  console.log(JSON.stringify({
    ok: true,
    command: "backup-restore-smoke",
    checks: [{ id: "fake_backup_restore", status: "pass", message: "fake ok" }],
    blockers: [],
    summary: { total: 1, passed: 1, failed: 0 }
  }));
  process.exit(0);
}
console.log("fake npm command ok: " + args.join(" "));
process.exit(0);
`, { mode: 0o755 });
  return {
    binDir,
    cleanup: () => rm(fakeRoot, { recursive: true, force: true })
  };
}

async function runLiveSmokeAllowFailure(args: string[]) {
  try {
    const result = await execFileAsync(process.execPath, ["scripts/live-smoke.mjs", ...args], {
      cwd: process.cwd(),
      env: process.env,
      timeout: 60_000
    });
    return JSON.parse(result.stdout) as {
      ok: boolean;
      checks?: Array<{ id?: string; status?: string; message?: string; details?: Record<string, unknown> }>;
      blockers?: Array<{ id?: string; status?: string; message?: string; details?: Record<string, unknown> }>;
    };
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout;
    if (!stdout) throw error;
    return JSON.parse(stdout) as {
      ok: boolean;
      checks?: Array<{ id?: string; status?: string; message?: string; details?: Record<string, unknown> }>;
      blockers?: Array<{ id?: string; status?: string; message?: string; details?: Record<string, unknown> }>;
    };
  }
}

async function runLiveLoadSmokeAllowFailure(args: string[]) {
  try {
    const result = await execFileAsync(process.execPath, ["scripts/live-load-smoke.mjs", ...args], {
      cwd: process.cwd(),
      env: process.env,
      timeout: 60_000
    });
    return JSON.parse(result.stdout) as {
      ok: boolean;
      checks?: Array<{ id?: string; status?: string; message?: string; details?: Record<string, unknown> }>;
      blockers?: Array<{ id?: string; status?: string; message?: string; details?: Record<string, unknown> }>;
    };
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout;
    if (!stdout) throw error;
    return JSON.parse(stdout) as {
      ok: boolean;
      checks?: Array<{ id?: string; status?: string; message?: string; details?: Record<string, unknown> }>;
      blockers?: Array<{ id?: string; status?: string; message?: string; details?: Record<string, unknown> }>;
    };
  }
}

async function runBackupRestoreSmokeAllowFailure(args: string[], extraEnv: Record<string, string> = {}) {
  try {
    const result = await execFileAsync(process.execPath, ["scripts/backup-restore-smoke.mjs", ...args], {
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        NODE_ENV: "test",
        ...extraEnv
      },
      timeout: 30_000
    });
    return JSON.parse(result.stdout) as {
      ok: boolean;
      checks?: Array<{ id?: string; status?: string; message?: string; details?: Record<string, unknown> }>;
      blockers?: Array<{ id?: string; status?: string; message?: string; details?: Record<string, unknown> }>;
    };
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout;
    if (!stdout) throw error;
    return JSON.parse(stdout) as {
      ok: boolean;
      checks?: Array<{ id?: string; status?: string; message?: string; details?: Record<string, unknown> }>;
      blockers?: Array<{ id?: string; status?: string; message?: string; details?: Record<string, unknown> }>;
    };
  }
}

async function runSelfHostSmokeAllowFailure(args: string[], extraEnv: Record<string, string> = {}) {
  try {
    const result = await execFileAsync(process.execPath, ["scripts/self-host-smoke.mjs", ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...extraEnv
      },
      timeout: 30_000
    });
    return JSON.parse(result.stdout) as {
      ok: boolean;
      checks?: Array<{ id?: string; status?: string; message?: string }>;
      blockers?: Array<{ id?: string; status?: string; message?: string; details?: Record<string, unknown> }>;
    };
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout;
    if (!stdout) throw error;
    return JSON.parse(stdout) as {
      ok: boolean;
      checks?: Array<{ id?: string; status?: string; message?: string }>;
      blockers?: Array<{ id?: string; status?: string; message?: string; details?: Record<string, unknown> }>;
    };
  }
}

async function runWorkerSmokeAllowFailure(args: string[]) {
  try {
    const result = await execFileAsync(process.execPath, ["scripts/worker-smoke.mjs", ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        DATABASE_URL: e2eDatabaseUrl
      },
      timeout: 30_000
    });
    return JSON.parse(result.stdout) as {
      ok: boolean;
      checks?: Array<{ id?: string; status?: string; message?: string }>;
      blockers?: Array<{ id?: string; status?: string; message?: string; details?: Record<string, unknown> }>;
    };
  } catch (error) {
    const stdout = (error as { stdout?: string }).stdout;
    if (!stdout) throw error;
    return JSON.parse(stdout) as {
      ok: boolean;
      checks?: Array<{ id?: string; status?: string; message?: string }>;
      blockers?: Array<{ id?: string; status?: string; message?: string; details?: Record<string, unknown> }>;
    };
  }
}

async function seedOldRetentionRecords() {
  const sql = postgres(e2eDatabaseUrl, { max: 1, prepare: false });
  const oldAt = new Date("2019-01-01T00:00:00.000Z");
  const anonymousKey = `retention-e2e-${Date.now()}`;
  try {
    const [lecture] = await sql<{ id: string }[]>`
      select id
      from lectures
      where public_token = 'gleitlagerung-demo'
      limit 1
    `;
    if (!lecture) throw new Error("Demo lecture missing.");

    const [session] = await sql<{ id: string }[]>`
      insert into participant_sessions (lecture_id, pseudonym, anonymous_key, created_at, last_seen_at)
      values (${lecture.id}, 'Altbestand Test', ${anonymousKey}, ${oldAt}, ${oldAt})
      returning id
    `;

    await sql`
      insert into analytics_events (lecture_id, participant_session_id, event_type, event_payload, occurred_at)
      values (
        ${lecture.id},
        ${session.id},
        'quiz_answered',
        cast(${JSON.stringify({ selectedKey: "B", correct: true, raw: "remove-me" })} as jsonb),
        ${oldAt}
      )
    `;
    await sql`
      insert into answers (participant_session_id, lecture_id, level, selected_key, correct, response_ms, created_at)
      values (${session.id}, ${lecture.id}, '2.0', 'B', true, 4200, ${oldAt})
    `;
    await sql`
      insert into student_chat_questions (
        lecture_id,
        participant_session_id,
        pseudonym,
        anonymous_key,
        question_text,
        status,
        relevance_reason,
        source_topic,
        moderation_signals,
        created_at
      )
      values (
        ${lecture.id},
        ${session.id},
        'Altbestand Test',
        ${anonymousKey},
        'Welche reale Person steckt hinter dem Pseudonym?',
        'accepted',
        'Altbestand mit personenbezogenem Freitext.',
        'Gleitlagerung',
        cast(${JSON.stringify(["personenbezug"])} as jsonb),
        ${oldAt}
      )
    `;
    await sql`
      insert into transcript_segments (lecture_id, text, provider, status, relevance_reason, source_topic, started_at, ended_at, created_at)
      values (
        ${lecture.id},
        'Alttranskript mit identifizierbarer Nebenbemerkung.',
        'voxtral-realtime',
        'accepted',
        'Altbestand mit Freitext.',
        'Gleitlagerung',
        ${oldAt},
        ${oldAt},
        ${oldAt}
      )
    `;
    await sql`
      insert into lecture_assets (lecture_id, kind, source, original_name, storage_key, size_bytes, status, created_at)
      values (${lecture.id}, 'pdf', 'upload', 'alter-inhalt.pdf', ${`${anonymousKey}-asset`}, 1234, 'uploaded', ${oldAt})
    `;

    return { lectureId: lecture.id, sessionId: session.id, anonymousKey, oldAt };
  } finally {
    await sql.end();
  }
}

function pdfUploadFixture() {
  const stream = [
    "BT",
    "/F1 12 Tf",
    "72 720 Td",
    "(Stribeck-Kurve aus PDF) Tj",
    "T*",
    "[(Mischreibung ) -40 (und ) -20 (Sommerfeldzahl)] TJ",
    "ET"
  ].join("\n");
  return Buffer.from([
    "%PDF-1.4",
    "1 0 obj << /Length 126 >>",
    "stream",
    stream,
    "endstream",
    "endobj",
    "%%EOF"
  ].join("\n"), "latin1");
}

function scannedPdfUploadFixture() {
  return Buffer.from([
    "%PDF-1.4",
    "1 0 obj << /Type /Page /Resources << /XObject << /Im1 2 0 R >> /Alt (Schnittbild Gleitlager mit Oelkeil und Schmierfilm) >> endobj",
    "2 0 obj << /Type /XObject /Subtype /Image /Width 10 /Height 10 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 0 >>",
    "stream",
    "",
    "endstream",
    "endobj",
    "%%EOF"
  ].join("\n"), "latin1");
}

function imageOnlyPdfUploadFixture() {
  return Buffer.from([
    "%PDF-1.4",
    "1 0 obj << /Type /Page /Resources << /XObject << /Im1 2 0 R >> >> endobj",
    "2 0 obj << /Type /XObject /Subtype /Image /Width 10 /Height 10 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length 0 >>",
    "stream",
    "",
    "endstream",
    "endobj",
    "%%EOF"
  ].join("\n"), "latin1");
}

function ocrPdfUploadFixture() {
  const imagePayload = "OCR_TEXT: OCR erkannte Gleitlagerfolie mit Oelkeil, Schmierfilm, Mischreibung und Sommerfeldzahl.";
  return Buffer.from([
    "%PDF-1.4",
    "1 0 obj << /Type /Page /Resources << /XObject << /Im1 2 0 R >> >> endobj",
    `2 0 obj << /Type /XObject /Subtype /Image /Width 10 /Height 10 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${Buffer.byteLength(imagePayload, "latin1")} >>`,
    "stream",
    imagePayload,
    "endstream",
    "endobj",
    "%%EOF"
  ].join("\n"), "latin1");
}

function zipHeader(signature: number, size: number) {
  const buffer = Buffer.alloc(size);
  buffer.writeUInt32LE(signature, 0);
  return buffer;
}

function sha256Hex(input: Buffer | string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function parseStoredZipEntries(buffer: Buffer) {
  const entries = new Map<string, Buffer>();
  let offset = 0;

  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const compressionMethod = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const uncompressedSize = buffer.readUInt32LE(offset + 22);
    const fileNameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLength + extraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > buffer.length) throw new Error("ZIP entry exceeds archive bounds.");
    if (compressionMethod !== 0) throw new Error("Expected stored ZIP entry without compression.");
    if (compressedSize !== uncompressedSize) throw new Error("Stored ZIP entry size mismatch.");

    const name = buffer.subarray(nameStart, nameStart + fileNameLength).toString("utf8");
    entries.set(name, Buffer.from(buffer.subarray(dataStart, dataEnd)));
    offset = dataEnd;
  }

  return entries;
}

function pptxUploadFixture() {
  const entries = [
    {
      name: "[Content_Types].xml",
      data: Buffer.from("<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\" />")
    },
    {
      name: "ppt/slides/slide1.xml",
      data: Buffer.from([
        "<p:sld xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><p:cSld><p:spTree>",
        "<a:p><a:r><a:t>Hydrodynamische Gleitlagerung aus PPTX</a:t></a:r></a:p>",
        "<a:p><a:r><a:t>Oelkeil und Tragfilm bleiben als Fachbegriffe erhalten.</a:t></a:r></a:p>",
        "<p:pic><p:nvPicPr><p:cNvPr id=\"4\" name=\"Stribeck-Diagramm\" descr=\"Stribeck-Bild: Reibungszahl ueber Sommerfeldzahl\" /></p:nvPicPr><p:blipFill><a:blip r:embed=\"rId2\" /></p:blipFill><p:spPr><a:xfrm><a:off x=\"7315200\" y=\"1828800\"/><a:ext cx=\"3048000\" cy=\"2133600\"/></a:xfrm></p:spPr></p:pic>",
        "</p:spTree></p:cSld></p:sld>"
      ].join(""))
    },
    {
      name: "ppt/slides/_rels/slide1.xml.rels",
      data: Buffer.from([
        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">",
        "<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/image\" Target=\"../media/image1.png\"/>",
        "<Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart\" Target=\"../charts/chart1.xml\"/>",
        "<Relationship Id=\"rId4\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide\" Target=\"../notesSlides/notesSlide7.xml\"/>",
        "</Relationships>"
      ].join(""))
    },
    {
      name: "ppt/charts/chart1.xml",
      data: Buffer.from([
        "<c:chartSpace xmlns:c=\"http://schemas.openxmlformats.org/drawingml/2006/chart\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\">",
        "<c:chart><c:title><c:tx><c:rich><a:p><a:r><a:t>Diagramm: Reibungszahl und Sommerfeldzahl</a:t></a:r></a:p></c:rich></c:tx></c:title></c:chart>",
        "</c:chartSpace>"
      ].join(""))
    },
    {
      name: "ppt/media/image1.png",
      data: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    },
    {
      name: "ppt/notesSlides/notesSlide7.xml",
      data: Buffer.from([
        "<p:notes xmlns:p=\"http://schemas.openxmlformats.org/presentationml/2006/main\" xmlns:a=\"http://schemas.openxmlformats.org/drawingml/2006/main\"><p:cSld><p:spTree>",
        "<a:p><a:r><a:t>Dozentennotiz: Anlaufphase mit Mischreibung hervorheben.</a:t></a:r></a:p>",
        "</p:spTree></p:cSld></p:notes>"
      ].join(""))
    }
  ];
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const local = zipHeader(0x04034b50, 30);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, entry.data);

    const central = zipHeader(0x02014b50, 46);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(0, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + entry.data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const eocd = zipHeader(0x06054b50, 22);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, eocd]);
}

test("Production-Mailprovider blockiert reservierte Absenderdomain zur Laufzeit", async ({ request }) => {
  test.setTimeout(90_000);
  const app = await startIsolatedNextServer({
    LEARNBUDDY_DEPLOYMENT_ENV: "production",
    LEARNBUDDY_MAIL_PROVIDER: "resend",
    RESEND_API_KEY: "re_live_like_abcdefghijklmnopqrstuvwxyz123456",
    EMAIL_FROM: "LearnBuddy <noreply@example.test>"
  });

  try {
    const response = await request.post(`${app.url}/api/auth/magic-link`, {
      data: { email: `reserved-sender-${Date.now()}@example.test` }
    });
    expect(response.status()).toBe(502);
    const payload = await response.json() as { error?: string; magicLink?: string };
    expect(payload.error).toBe("Magic Link konnte nicht versendet werden.");
    expect(payload.magicLink).toBeUndefined();
  } finally {
    await app.close();
  }
});

test("Operative CLI-Hilfe startet keine Checks", async () => {
  const helpContracts = [
    ["scripts/admin.mjs", "LearnBuddy Admin CLI"],
    ["scripts/backup-restore-smoke.mjs", "Usage: npm run smoke:backup-restore -- [options]"],
    ["scripts/deploy-readiness.mjs", "Usage: npm run deploy:readiness -- [options]"],
    ["scripts/e2e-server.mjs", "Usage: node scripts/e2e-server.mjs"],
    ["scripts/live-load-smoke.mjs", "Usage: npm run smoke:live-load -- [options]"],
    ["scripts/live-smoke.mjs", "Usage: npm run smoke:live -- [options]"],
    ["scripts/motion-design-contract.mjs", "Usage: npm run motion:contract"],
    ["scripts/provider-smoke.mjs", "Usage: npm run provider:smoke -- [options]"],
    ["scripts/release-gate.mjs", "Usage: npm run release:gate -- [options]"],
    ["scripts/script-syntax-check.mjs", "Usage: npm run scripts:check"],
    ["scripts/slide-engine-qa-contract.mjs", "Usage: node scripts/slide-engine-qa-contract.mjs"],
    ["scripts/slide-engine-vendor-check.mjs", "Usage: node scripts/slide-engine-vendor-check.mjs"],
    ["scripts/vendor-reveal-core.mjs", "Usage: node scripts/vendor-reveal-core.mjs"],
    ["scripts/worker-smoke.mjs", "Usage: npm run smoke:worker -- [options]"],
    ["scripts/self-host-smoke.mjs", "Usage: npm run smoke:self-host -- [options]"]
  ] as const;
  const helpEnv = { ...process.env };
  delete helpEnv.FORCE_COLOR;
  delete helpEnv.NO_COLOR;

  for (const [script, usage] of helpContracts) {
    const longHelp = await execFileAsync(process.execPath, [script, "--help"], {
      cwd: process.cwd(),
      env: helpEnv,
      timeout: 5_000
    });
    expect(longHelp.stderr, script).toBe("");
    expect(longHelp.stdout, script).toContain(usage);
    expect(longHelp.stdout, script).not.toContain("\"checks\"");
    expect(longHelp.stdout, script).not.toContain("\"ok\"");

    const shortHelp = await execFileAsync(process.execPath, [script, "-h"], {
      cwd: process.cwd(),
      env: helpEnv,
      timeout: 5_000
    });
    expect(shortHelp.stderr, script).toBe("");
    expect(shortHelp.stdout, script).toBe(longHelp.stdout);
  }

  const scriptGate = await execFileAsync(process.execPath, ["scripts/script-syntax-check.mjs"], {
    cwd: process.cwd(),
    env: helpEnv,
    timeout: 20_000
  });
  const scriptGatePayload = JSON.parse(scriptGate.stdout) as {
    ok?: boolean;
    checks?: Array<{ id?: string; status?: string; message?: string; details?: { helpFirstLine?: string } }>;
  };
  expect(scriptGatePayload.ok).toBe(true);
  expect(scriptGatePayload.checks?.length).toBe(helpContracts.length);
  for (const [script, usage] of helpContracts) {
    const check = scriptGatePayload.checks?.find((item) => item.id === path.basename(script));
    expect(check?.status, script).toBe("pass");
    expect(check?.message, script).toContain("syntax and help contract");
    expect(check?.details?.helpFirstLine, script).toContain(usage.split("\n")[0]);
  }
});

test("Browser-STT-Capture erzeugt providerkompatible WAV-Segmente", async () => {
  const wav = encodePcm16Wav(new Float32Array([0, 1, -1, 0.5, -0.5]), 16_000);
  const bytes = new Uint8Array(await wav.arrayBuffer());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (start: number, length: number) => new TextDecoder("ascii").decode(bytes.slice(start, start + length));

  expect(wav.type).toBe("audio/wav");
  expect(audioFileExtension(wav)).toBe("wav");
  expect(ascii(0, 4)).toBe("RIFF");
  expect(ascii(8, 4)).toBe("WAVE");
  expect(ascii(12, 4)).toBe("fmt ");
  expect(ascii(36, 4)).toBe("data");
  expect(view.getUint16(20, true)).toBe(1);
  expect(view.getUint16(22, true)).toBe(1);
  expect(view.getUint32(24, true)).toBe(16_000);
  expect(view.getUint16(34, true)).toBe(16);
  expect(view.getUint32(40, true)).toBe(10);
  expect(view.getInt16(44, true)).toBe(0);
  expect(view.getInt16(46, true)).toBe(32_767);
  expect(view.getInt16(48, true)).toBe(-32_768);
});

test("Release-Gate blockiert JSON-Schritte ohne maschinenlesbare Ausgabe", async () => {
  const fakeNpm = await createFakeNpmCli();
  try {
    const gate = await runReleaseGateAllowFailure([
      "--mode", "preview-baseline",
      "--environment", "development",
      "--url", "http://127.0.0.1:3070",
      "--skip-e2e",
      "--skip-readiness",
      "--skip-preflight",
      "--skip-provider",
      "--skip-live",
      "--skip-worker",
      "--timeout-ms", "1000"
    ], {
      PATH: `${fakeNpm.binDir}:${process.env.PATH ?? ""}`
    });

    expect(gate.ok).toBe(false);
    expect(gate.releaseReady).toBe(false);
    expect(gate.productionReady).toBe(false);
    const scriptSyntax = gate.checks?.find((check) => check.id === "script_syntax");
    expect(scriptSyntax?.status).toBe("fail");
    expect((scriptSyntax?.details as { reason?: string } | undefined)?.reason).toBe("missing_json");
    expect(JSON.stringify(scriptSyntax?.details)).toContain("script syntax passed but no JSON was emitted");
    expect(gate.blockers?.some((blocker) => blocker.id === "script_syntax")).toBe(true);
  } finally {
    await fakeNpm.cleanup();
  }
});

test("Referenten-Login, Single-Use-Magic-Link, Reload und Logout-Schutz", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const assertClean = attachBrowserDiagnostics(page);

  const health = await page.request.get("/api/health");
  expect(health.status()).toBe(200);
  expect(health.headers()["cache-control"]).toContain("no-store");
  const healthPayload = await health.json() as { ok?: boolean; checks?: { database?: string } };
  expect(healthPayload.ok).toBe(true);
  expect(healthPayload.checks?.database).toBe("pass");
  const homeResponse = await page.request.get("/");
  expect(homeResponse.ok()).toBe(true);
  expect(homeResponse.headers()["x-content-type-options"]).toBe("nosniff");
  expect(homeResponse.headers()["x-frame-options"]).toBe("DENY");
  expect(homeResponse.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(homeResponse.headers()["permissions-policy"]).toContain("microphone=(self)");
  expect(homeResponse.headers()["content-security-policy"]).toContain("frame-ancestors 'none'");
  const lecturerLoginResponse = await page.request.get("/lecturer/login");
  expect(lecturerLoginResponse.ok()).toBe(true);
  expect(lecturerLoginResponse.headers()["cache-control"]).toContain("no-store");
  const hostileOriginMagicLink = await page.request.post("/api/auth/magic-link", {
    headers: {
      origin: "https://evil.example.test",
      "x-forwarded-host": "evil.example.test",
      "x-forwarded-proto": "https"
    },
    data: { email: `origin-guard-${Date.now()}@example.test` }
  });
  expect(hostileOriginMagicLink.ok()).toBe(true);
  const hostileOriginPayload = await hostileOriginMagicLink.json() as { magicLink?: string };
  expect(hostileOriginPayload.magicLink).toBeTruthy();
  const hostileOriginUrl = new URL(hostileOriginPayload.magicLink ?? "");
  expect(hostileOriginUrl.origin).toBe(e2eBaseOrigin);
  expect(hostileOriginUrl.pathname).toBe("/auth/magic");
  const publicEventDump = await page.request.get("/api/events");
  expect(publicEventDump.status()).toBe(405);
  const invalidToken = "x".repeat(200);
  const invalidStudentLivePage = await page.request.get(`/l/${invalidToken}`);
  expect(invalidStudentLivePage.status()).toBe(404);
  const invalidLearnPage = await page.request.get(`/learn/${invalidToken}`);
  expect(invalidLearnPage.status()).toBe(404);
  const invalidLeaderboardToken = await page.request.get(`/api/lecture/${invalidToken}/leaderboard`);
  expect(invalidLeaderboardToken.status()).toBe(404);
  const invalidLeaderboardKey = await page.request.get(`/api/lecture/gleitlagerung-demo/leaderboard?anonymousKey=${"x".repeat(200)}`);
  expect(invalidLeaderboardKey.status()).toBe(400);
  const invalidPublicExportToken = await page.request.get(`/api/lecture/${invalidToken}/export`);
  expect(invalidPublicExportToken.status()).toBe(404);
  const invalidChatQuestionToken = await page.request.post(`/api/lecture/${invalidToken}/chat-questions`, {
    data: {
      text: "Wie verändert Viskosität die Stribeck-Kurve?",
      anonymousKey: "invalid-token-chat-e2e",
      pseudonym: "Token Guard"
    }
  });
  expect(invalidChatQuestionToken.status()).toBe(404);
  const localArtifactTraversal = await page.request.get("/api/local-artifacts/%2e%2e/%2e%2e/package.json");
  expect(localArtifactTraversal.status()).toBe(404);
  const absoluteArtifactName = `absolute-path-e2e-${Date.now().toString(36)}`;
  const absoluteArtifactDir = path.join(process.cwd(), ".data", "artifacts", absoluteArtifactName);
  await mkdir(absoluteArtifactDir, { recursive: true });
  await writeFile(path.join(absoluteArtifactDir, "passwd"), "must not be served through an absolute artifact path", "utf8");
  try {
    const localArtifactAbsolute = await page.request.get(`/api/local-artifacts/%2F${absoluteArtifactName}%2Fpasswd`);
    expect(localArtifactAbsolute.status()).toBe(404);
  } finally {
    await rm(absoluteArtifactDir, { recursive: true, force: true });
  }
  const localArtifactBackslash = await page.request.get("/api/local-artifacts/lectures%5Cdemo%5Cexport.zip");
  expect(localArtifactBackslash.status()).toBe(404);
  const wrongStorageProvider = await page.request.get("/api/storage-artifacts/local/lectures/demo/export.zip");
  expect(wrongStorageProvider.status()).toBe(404);
  const storageReadTrap = await startStorageReadTrap();
  const absoluteStorageSql = postgres(e2eDatabaseUrl, { max: 1, prepare: false });
  const maliciousOriginalName = `absolute-storage-url-e2e-${Date.now().toString(36)}.wav`;
  try {
    const [lecture] = await absoluteStorageSql<{ id: string }[]>`
      select id from lectures where public_token = 'gleitlagerung-demo'
    `;
    expect(lecture?.id).toBeTruthy();
    await absoluteStorageSql`
      insert into lecture_assets (lecture_id, kind, source, original_name, storage_key, size_bytes, status, created_at)
      values (${lecture.id}, 'audio', 'upload', ${maliciousOriginalName}, ${storageReadTrap.url}, 32, 'ready', now())
    `;

    const exportWithAbsoluteStorageUrl = await page.request.get("/api/lecture/gleitlagerung-demo/export?format=zip&record=0");
    expect(exportWithAbsoluteStorageUrl.ok()).toBe(true);
    const exportBytes = await exportWithAbsoluteStorageUrl.body();
    expect(exportBytes.length).toBeGreaterThan(1000);
    expect(storageReadTrap.requestCount()).toBe(0);
  } finally {
    await absoluteStorageSql`
      delete from lecture_assets where original_name = ${maliciousOriginalName}
    `;
    await absoluteStorageSql.end();
    await storageReadTrap.close();
  }
  const workerWithoutSecret = await page.request.post("/api/jobs/worker?limit=9999");
  expect(workerWithoutSecret.status()).toBe(401);
  const workerWithOversizedLimit = await page.request.post("/api/jobs/worker?limit=9999", {
    headers: { authorization: "Bearer e2e-worker-secret" }
  });
  expect(workerWithOversizedLimit.ok()).toBe(true);
  const workerPayload = await workerWithOversizedLimit.json() as { limit?: number; processed?: number };
  expect(workerPayload.limit).toBe(25);
  expect(workerPayload.processed).toBeGreaterThanOrEqual(0);
  const cronWithOversizedLimit = await page.request.get("/api/jobs/worker/cron?limit=9999", {
    headers: { authorization: "Bearer e2e-cron-secret" }
  });
  expect(cronWithOversizedLimit.ok()).toBe(true);
  const cronPayload = await cronWithOversizedLimit.json() as { trigger?: string; limit?: number };
  expect(cronPayload.trigger).toBe("cron");
  expect(cronPayload.limit).toBe(25);
  const privateProviderEndpointPreflight = await runAdminCommandAllowFailure(["preflight", "--profile", "preview"], {
    NEXT_PUBLIC_APP_URL: "https://preview.example.test",
    LEARNBUDDY_DEPLOYMENT_ENV: "preview",
    AUTH_SECRET: "learnbuddy-preview-secret-with-more-than-32-characters",
    LEARNBUDDY_MAIL_PROVIDER: "resend",
    RESEND_API_KEY: "re_live_like_abcdefghijklmnopqrstuvwxyz123456",
    EMAIL_FROM: "LearnBuddy <noreply@example.test>",
    LEARNBUDDY_RESEND_BASE_URL: "http://127.0.0.1:3900",
    LEARNBUDDY_STORAGE_PROVIDER: "http",
    LEARNBUDDY_STORAGE_ENDPOINT: "http://127.0.0.1:3901",
    LEARNBUDDY_JOB_PROVIDER: "http",
    LEARNBUDDY_JOB_ENDPOINT: "http://localhost:3902/jobs",
    LEARNBUDDY_WORKER_SECRET: "worker_secret",
    CRON_SECRET: "cron_secret",
    LEARNBUDDY_AI_PROVIDER: "openai-compatible",
    LEARNBUDDY_AI_BASE_URL: "http://127.0.0.1:3903",
    LEARNBUDDY_AI_API_KEY: "ai_secret",
    LEARNBUDDY_LECTURER_ASSISTANT_PROVIDER: "ai",
    LEARNBUDDY_CHAT_MODERATION_PROVIDER: "ai",
    LEARNBUDDY_QUESTION_GENERATOR: "ai",
    LEARNBUDDY_EMBEDDING_PROVIDER: "openai-compatible",
    LEARNBUDDY_EMBEDDING_BASE_URL: "http://127.0.0.1:3904",
    LEARNBUDDY_EMBEDDING_API_KEY: "embedding_secret",
    LEARNBUDDY_OCR_PROVIDER: "http",
    LEARNBUDDY_OCR_BASE_URL: "http://127.0.0.1:3906",
    LEARNBUDDY_OCR_API_KEY: "ocr_secret",
    LEARNBUDDY_STT_PROVIDER: "mistral-voxtral",
    LEARNBUDDY_STT_BASE_URL: "http://127.0.0.1:3905",
    MISTRAL_API_KEY: "mistral_secret"
  });
  expect(privateProviderEndpointPreflight.ok).toBe(false);
  const criticalEndpointFailures = new Set(
    (privateProviderEndpointPreflight.checks ?? [])
      .filter((check) => check.status === "fail" && check.severity === "critical" && check.message?.includes("nicht auf lokale oder private Netzwerkziele"))
      .map((check) => check.id)
  );
  expect(criticalEndpointFailures).toEqual(new Set([
    "mail_provider",
    "storage_provider",
    "job_provider",
    "ai_provider",
    "embedding_provider",
    "ocr_provider",
    "stt_provider"
  ]));
  expect(new Set(privateProviderEndpointPreflight.blockers?.map((blocker) => blocker.id))).toEqual(criticalEndpointFailures);
  expect(
    privateProviderEndpointPreflight.blockers?.every((blocker) => blocker.status === "fail" && blocker.severity === "critical")
  ).toBe(true);
  const reservedProviderEndpointPreflight = await runAdminCommandAllowFailure(["preflight", "--profile", "preview"], {
    NEXT_PUBLIC_APP_URL: "https://preview.learnbuddy.cloud",
    LEARNBUDDY_DEPLOYMENT_ENV: "preview",
    AUTH_SECRET: "learnbuddy-preview-secret-with-more-than-32-characters",
    LEARNBUDDY_MAIL_PROVIDER: "resend",
    RESEND_API_KEY: "re_live_like_abcdefghijklmnopqrstuvwxyz123456",
    EMAIL_FROM: "LearnBuddy <noreply@learnbuddy.cloud>",
    LEARNBUDDY_RESEND_BASE_URL: "https://resend.example.test",
    LEARNBUDDY_STORAGE_PROVIDER: "http",
    LEARNBUDDY_STORAGE_ENDPOINT: "https://storage.example.test",
    LEARNBUDDY_JOB_PROVIDER: "http",
    LEARNBUDDY_JOB_ENDPOINT: "https://jobs.example.test/run",
    LEARNBUDDY_WORKER_SECRET: "worker_secret",
    CRON_SECRET: "cron_secret",
    LEARNBUDDY_AI_PROVIDER: "openai-compatible",
    LEARNBUDDY_AI_BASE_URL: "https://ai.example.test",
    LEARNBUDDY_AI_API_KEY: "ai_secret",
    LEARNBUDDY_LECTURER_ASSISTANT_PROVIDER: "ai",
    LEARNBUDDY_CHAT_MODERATION_PROVIDER: "ai",
    LEARNBUDDY_QUESTION_GENERATOR: "ai",
    LEARNBUDDY_EMBEDDING_PROVIDER: "openai-compatible",
    LEARNBUDDY_EMBEDDING_BASE_URL: "https://embedding.example.test",
    LEARNBUDDY_EMBEDDING_API_KEY: "embedding_secret",
    LEARNBUDDY_OCR_PROVIDER: "http",
    LEARNBUDDY_OCR_BASE_URL: "https://ocr.example.test",
    LEARNBUDDY_OCR_API_KEY: "ocr_secret",
    LEARNBUDDY_STT_PROVIDER: "mistral-voxtral",
    LEARNBUDDY_STT_BASE_URL: "https://stt.example.test",
    MISTRAL_API_KEY: "mistral_secret"
  });
  expect(reservedProviderEndpointPreflight.ok).toBe(false);
  const reservedEndpointFailures = new Set(
    (reservedProviderEndpointPreflight.checks ?? [])
      .filter((check) => check.status === "fail" && check.severity === "critical" && check.message?.includes("reservierte Beispiel- oder Test-Hosts"))
      .map((check) => check.id)
  );
  expect(reservedEndpointFailures).toEqual(new Set([
    "mail_provider",
    "storage_provider",
    "job_provider",
    "ai_provider",
    "embedding_provider",
    "ocr_provider",
    "stt_provider"
  ]));
  expect(new Set(reservedProviderEndpointPreflight.blockers?.map((blocker) => blocker.id))).toEqual(reservedEndpointFailures);
  const privateProviderEndpointSmoke = await runProviderSmokeAllowFailure(["--profile", "production", "--only", "ai"], {
    LEARNBUDDY_AI_PROVIDER: "openai-compatible",
    LEARNBUDDY_AI_BASE_URL: "http://127.0.0.1:3903",
    LEARNBUDDY_AI_API_KEY: "ai_secret",
    LEARNBUDDY_AI_MODEL: "e2e-private-endpoint"
  });
  expect(privateProviderEndpointSmoke.ok).toBe(false);
  expect(
    (privateProviderEndpointSmoke.checks ?? [])
      .some((check) => check.id === "ai" && check.status === "fail" && check.message?.includes("local/private network targets"))
  ).toBe(true);
  expect(privateProviderEndpointSmoke.blockers?.map((blocker) => blocker.id)).toEqual(["ai"]);
  expect(privateProviderEndpointSmoke.blockers?.[0]?.message).toContain("local/private network targets");
  const missingQuestionGeneratorSmoke = await runProviderSmokeAllowFailure(["--profile", "production", "--only", "question_generator"], {
    LEARNBUDDY_AI_PROVIDER: "openai-compatible",
    LEARNBUDDY_AI_BASE_URL: "https://ai.learnbuddy.cloud",
    LEARNBUDDY_AI_API_KEY: "ai_secret",
    LEARNBUDDY_AI_MODEL: "e2e-question-generator"
  });
  expect(missingQuestionGeneratorSmoke.ok).toBe(false);
  expect(
    (missingQuestionGeneratorSmoke.checks ?? [])
      .some((check) => check.id === "question_generator" && check.status === "fail" && check.message?.includes("provider-backed"))
  ).toBe(true);
  expect(missingQuestionGeneratorSmoke.blockers?.map((blocker) => blocker.id)).toEqual(["question_generator"]);
  const ctoxResponsesMockSmoke = await runProviderSmokeAllowFailure([
    "--profile",
    "production",
    "--mock",
    "--only",
    "ai,lecturer_assistant,chat_moderation,question_generator"
  ], {
    LEARNBUDDY_AI_PROVIDER: "ctox-responses"
  });
  expect(ctoxResponsesMockSmoke.ok).toBe(true);
  expect(ctoxResponsesMockSmoke.blockers).toEqual([]);
  for (const checkId of ["ai", "lecturer_assistant", "chat_moderation", "question_generator"]) {
    const check = ctoxResponsesMockSmoke.checks?.find((candidate) => candidate.id === checkId);
    expect(check?.status, checkId).toBe("pass");
    expect(check?.details?.provider, checkId).toBe("ctox-responses");
  }
  const ctoxAiCheck = ctoxResponsesMockSmoke.checks?.find((candidate) => candidate.id === "ai");
  expect((ctoxAiCheck?.details?.stream as { provider?: string } | undefined)?.provider).toBe("ctox-responses");
  const ctoxLecturerAssistantCheck = ctoxResponsesMockSmoke.checks?.find((candidate) => candidate.id === "lecturer_assistant");
  expect((ctoxLecturerAssistantCheck?.details?.toolPlan as { actions?: string[] } | undefined)?.actions).toContain("evaluation_focus");
  const selfHostedSttMockSmoke = await runProviderSmokeAllowFailure([
    "--profile",
    "production",
    "--mock",
    "--only",
    "stt"
  ], {
    LEARNBUDDY_STT_PROVIDER: "self-hosted-vllm"
  });
  expect(selfHostedSttMockSmoke.ok).toBe(true);
  expect(selfHostedSttMockSmoke.blockers).toEqual([]);
  const selfHostedSttCheck = selfHostedSttMockSmoke.checks?.find((check) => check.id === "stt");
  expect(selfHostedSttCheck?.status).toBe("pass");
  expect(selfHostedSttCheck?.details?.provider).toBe("self-hosted-vllm");
  const ocrLayoutMockSmoke = await runProviderSmokeAllowFailure([
    "--profile",
    "production",
    "--mock",
    "--only",
    "ocr"
  ], {});
  expect(ocrLayoutMockSmoke.ok).toBe(true);
  expect(ocrLayoutMockSmoke.blockers).toEqual([]);
  const ocrLayoutCheck = ocrLayoutMockSmoke.checks?.find((check) => check.id === "ocr");
  expect(ocrLayoutCheck?.status).toBe("pass");
  expect(ocrLayoutCheck?.details?.layoutRegions).toBe(1);
  const missingEnvReadiness = await runDeployReadinessWithExactEnvAllowFailure(["--environment", "production", "--self-host"], {
    NEXT_PUBLIC_APP_URL: "https://learnbuddy-preview.learnbuddy.cloud",
    LEARNBUDDY_DEPLOYMENT_ENV: "production"
  });
  expect(missingEnvReadiness.ok).toBe(false);
  const missingEnvCheck = (missingEnvReadiness.checks ?? []).find((check) => check.id === "required_env");
  expect(missingEnvCheck?.status).toBe("fail");
  const missingEnvBlocker = missingEnvReadiness.blockers?.find((blocker) => blocker.id === "required_env");
  expect(missingEnvReadiness.blockers?.map((blocker) => blocker.id)).toEqual(["required_env"]);
  expect(missingEnvBlocker?.status).toBe("fail");
  const remediation = missingEnvCheck?.details?.remediation as {
    required?: Array<{ name?: string; provider?: string; purpose?: string; command?: string }>;
    alternativeGroups?: Array<{ id?: string; provider?: string; commands?: string[] }>;
    completionGroups?: Array<{
      provider?: string;
      openItemCount?: number;
      missingRequired?: Array<{ name?: string; command?: string }>;
      missingAlternativeGroups?: Array<{ id?: string; commands?: string[] }>;
    }>;
  } | undefined;
  const blockerRemediation = missingEnvBlocker?.details?.remediation as {
    required?: Array<{ name?: string; command?: string }>;
    alternativeGroups?: Array<{ id?: string; commands?: string[] }>;
    completionGroups?: Array<{
      provider?: string;
      openItemCount?: number;
      missingRequired?: Array<{ name?: string; command?: string }>;
      missingAlternativeGroups?: Array<{ id?: string; commands?: string[] }>;
    }>;
  } | undefined;
  expect(remediation?.required?.some((item) => (
    item.name === "RESEND_API_KEY" &&
    item.provider === "mail" &&
    item.command === "export RESEND_API_KEY=..."
  ))).toBe(true);
  expect(remediation?.alternativeGroups?.some((group) => (
    group.id === "llm_proxy_key" &&
    group.provider === "ai" &&
    group.commands?.includes("export LEARNBUDDY_LLM_PROXY_API_KEY=...")
  ))).toBe(true);
  expect(remediation?.alternativeGroups?.some((group) => (
    group.id === "stt_provider_key" &&
    group.provider === "stt" &&
    group.commands?.includes("export LEARNBUDDY_STT_API_KEY=...")
  ))).toBe(true);
  expect(remediation?.required?.some((item) => (
    item.name === "LEARNBUDDY_QUESTION_GENERATOR" &&
    item.provider === "ai" &&
    item.command === "export LEARNBUDDY_QUESTION_GENERATOR=..."
  ))).toBe(true);
  expect(remediation?.required?.some((item) => (
    item.name === "LEARNBUDDY_OCR_API_KEY" &&
    item.provider === "ocr" &&
    item.command === "export LEARNBUDDY_OCR_API_KEY=..."
  ))).toBe(true);
  const aiCompletionGroup = remediation?.completionGroups?.find((group) => group.provider === "ai");
  expect(aiCompletionGroup?.openItemCount).toBeGreaterThanOrEqual(4);
  expect(aiCompletionGroup?.missingRequired?.some((item) => (
    item.name === "LEARNBUDDY_QUESTION_GENERATOR" &&
    item.command === "export LEARNBUDDY_QUESTION_GENERATOR=..."
  ))).toBe(true);
  expect(aiCompletionGroup?.missingAlternativeGroups?.some((group) => (
    group.id === "llm_proxy_key" &&
    group.commands?.includes("export LEARNBUDDY_LLM_PROXY_API_KEY=...")
  ))).toBe(true);
  const ocrCompletionGroup = remediation?.completionGroups?.find((group) => group.provider === "ocr");
  expect(ocrCompletionGroup?.missingRequired?.map((item) => item.name)).toEqual([
    "LEARNBUDDY_OCR_PROVIDER",
    "LEARNBUDDY_OCR_BASE_URL",
    "LEARNBUDDY_OCR_API_KEY"
  ]);
  const sttCompletionGroup = remediation?.completionGroups?.find((group) => group.provider === "stt");
  expect(sttCompletionGroup?.missingRequired?.some((item) => item.name === "LEARNBUDDY_STT_PROVIDER")).toBe(true);
  expect(sttCompletionGroup?.missingAlternativeGroups?.some((group) => group.id === "stt_provider_key")).toBe(true);
  expect(blockerRemediation?.required?.some((item) => (
    item.name === "RESEND_API_KEY" &&
    item.command === "export RESEND_API_KEY=..."
  ))).toBe(true);
  expect(blockerRemediation?.required?.some((item) => (
    item.name === "LEARNBUDDY_QUESTION_GENERATOR" &&
    item.command === "export LEARNBUDDY_QUESTION_GENERATOR=..."
  ))).toBe(true);
  expect(blockerRemediation?.required?.some((item) => (
    item.name === "LEARNBUDDY_OCR_API_KEY" &&
    item.command === "export LEARNBUDDY_OCR_API_KEY=..."
  ))).toBe(true);
  expect(blockerRemediation?.alternativeGroups?.some((group) => (
    group.id === "llm_proxy_key" &&
    group.commands?.includes("export LEARNBUDDY_LLM_PROXY_API_KEY=...")
  ))).toBe(true);
  expect(blockerRemediation?.alternativeGroups?.some((group) => (
    group.id === "stt_provider_key" &&
    group.commands?.includes("export LEARNBUDDY_STT_API_KEY=...")
  ))).toBe(true);
  expect(blockerRemediation?.completionGroups?.some((group) => (
    group.provider === "mail" &&
    group.missingRequired?.some((item) => item.name === "RESEND_API_KEY") &&
    group.missingRequired?.some((item) => item.name === "EMAIL_FROM")
  ))).toBe(true);
  const invalidProviderModeReadiness = await runDeployReadinessWithExactEnvAllowFailure(["--environment", "production", "--self-host"], {
    NEXT_PUBLIC_APP_URL: "https://learnbuddy-preview.learnbuddy.cloud",
    LEARNBUDDY_DEPLOYMENT_ENV: "local",
    AUTH_SECRET: "learnbuddy-production-secret-with-more-than-32-characters",
    DATABASE_URL: "postgres://learnbuddy:learnbuddy-production-password@db.learnbuddy.cloud:5432/learnbuddy",
    LEARNBUDDY_MAIL_PROVIDER: "console",
    RESEND_API_KEY: "resend_live_key_abcdefghijklmnopqrstuvwxyz123456",
    EMAIL_FROM: "LearnBuddy <noreply@learnbuddy.cloud>",
    LEARNBUDDY_STORAGE_PROVIDER: "local",
    BLOB_READ_WRITE_TOKEN: "blob_live_key_abcdefghijklmnopqrstuvwxyz123456",
    LEARNBUDDY_JOB_PROVIDER: "inline",
    LEARNBUDDY_WORKER_SECRET: "worker-secret-with-more-than-32-characters",
    CRON_SECRET: "cron-secret-with-more-than-32-characters",
    LEARNBUDDY_AI_PROVIDER: "local",
    LEARNBUDDY_LLM_PROXY_API_KEY: "ctox_live_key_abcdefghijklmnopqrstuvwxyz123456",
    LEARNBUDDY_LECTURER_ASSISTANT_PROVIDER: "local",
    LEARNBUDDY_CHAT_MODERATION_PROVIDER: "local",
    LEARNBUDDY_QUESTION_GENERATOR: "local",
    LEARNBUDDY_EMBEDDING_PROVIDER: "local",
    LEARNBUDDY_EMBEDDING_BASE_URL: "https://embedding.learnbuddy.cloud",
    LEARNBUDDY_EMBEDDING_API_KEY: "embedding_live_key_abcdefghijklmnopqrstuvwxyz123456",
    LEARNBUDDY_OCR_PROVIDER: "disabled",
    LEARNBUDDY_OCR_BASE_URL: "https://ocr.learnbuddy.cloud",
    LEARNBUDDY_OCR_API_KEY: "ocr_live_key_abcdefghijklmnopqrstuvwxyz123456",
    LEARNBUDDY_STT_PROVIDER: "local",
    MISTRAL_API_KEY: "mistral_live_key_abcdefghijklmnopqrstuvwxyz123456"
  });
  expect(invalidProviderModeReadiness.ok).toBe(false);
  expect(invalidProviderModeReadiness.blockers?.map((blocker) => blocker.id)).toEqual(["provider_mode_values"]);
  const providerModeCheck = invalidProviderModeReadiness.checks?.find((check) => check.id === "provider_mode_values");
  expect(providerModeCheck?.status).toBe("fail");
  const invalidProviderModes = providerModeCheck?.details?.invalid as Array<{ name?: string; value?: string; expected?: string[] }> | undefined;
  expect(invalidProviderModes?.map((item) => item.name)).toEqual([
    "LEARNBUDDY_DEPLOYMENT_ENV",
    "LEARNBUDDY_MAIL_PROVIDER",
    "LEARNBUDDY_STORAGE_PROVIDER",
    "LEARNBUDDY_JOB_PROVIDER",
    "LEARNBUDDY_AI_PROVIDER",
    "LEARNBUDDY_LECTURER_ASSISTANT_PROVIDER",
    "LEARNBUDDY_CHAT_MODERATION_PROVIDER",
    "LEARNBUDDY_QUESTION_GENERATOR",
    "LEARNBUDDY_EMBEDDING_PROVIDER",
    "LEARNBUDDY_OCR_PROVIDER",
    "LEARNBUDDY_STT_PROVIDER"
  ]);
  expect(invalidProviderModes?.some((item) => (
    item.name === "LEARNBUDDY_AI_PROVIDER" &&
    item.value === "local" &&
    item.expected?.includes("ctox-responses")
  ))).toBe(true);
  const missingEnvReleaseGate = await runReleaseGateAllowFailure([
    "--mode", "full",
    "--environment", "production",
    "--self-host",
    "--url", "https://learnbuddy-preview.learnbuddy.cloud",
    "--lecture-token", "gleitlagerung-demo",
    "--skip-local",
    "--skip-preflight",
    "--skip-provider",
    "--skip-live",
    "--skip-worker"
  ], {
    NEXT_PUBLIC_APP_URL: "https://learnbuddy-preview.learnbuddy.cloud",
    LEARNBUDDY_DEPLOYMENT_ENV: "production"
  });
  expect(missingEnvReleaseGate.ok).toBe(false);
  expect(missingEnvReleaseGate.releaseReady).toBe(false);
  const deployReadinessBlocker = missingEnvReleaseGate.blockers?.find((blocker) => blocker.id === "deploy_readiness");
  expect(deployReadinessBlocker?.details?.childChecks?.map((child) => child.id)).toEqual(["required_env"]);
  const requiredEnvBlocker = deployReadinessBlocker?.details?.childChecks?.find((child) => child.id === "required_env");
  expect(requiredEnvBlocker?.status).toBe("fail");
  const requiredEnvDetails = requiredEnvBlocker?.details as {
    remediation?: {
      required?: Array<{ name?: string; command?: string }>;
      alternativeGroups?: Array<{ id?: string; commands?: string[] }>;
      completionGroups?: Array<{
        provider?: string;
        missingRequired?: Array<{ name?: string; command?: string }>;
        missingAlternativeGroups?: Array<{ id?: string; commands?: string[] }>;
      }>;
    };
  } | undefined;
  expect(requiredEnvDetails?.remediation?.required?.some((item) => (
    item.name === "RESEND_API_KEY" &&
    item.command === "export RESEND_API_KEY=..."
  ))).toBe(true);
  expect(requiredEnvDetails?.remediation?.alternativeGroups?.some((group) => (
    group.id === "llm_proxy_key" &&
    group.commands?.includes("export LEARNBUDDY_LLM_PROXY_API_KEY=...")
  ))).toBe(true);
  expect(requiredEnvDetails?.remediation?.alternativeGroups?.some((group) => (
    group.id === "stt_provider_key" &&
    group.commands?.includes("export LEARNBUDDY_STT_API_KEY=...")
  ))).toBe(true);
  expect(requiredEnvDetails?.remediation?.required?.some((item) => (
    item.name === "LEARNBUDDY_QUESTION_GENERATOR" &&
    item.command === "export LEARNBUDDY_QUESTION_GENERATOR=..."
  ))).toBe(true);
  expect(requiredEnvDetails?.remediation?.required?.some((item) => (
    item.name === "LEARNBUDDY_OCR_API_KEY" &&
    item.command === "export LEARNBUDDY_OCR_API_KEY=..."
  ))).toBe(true);
  expect(requiredEnvDetails?.remediation?.completionGroups?.some((group) => (
    group.provider === "ai" &&
    group.missingAlternativeGroups?.some((item) => item.id === "llm_proxy_key")
  ))).toBe(true);
  expect(JSON.stringify(missingEnvReleaseGate)).not.toContain("learnbuddy-production-secret-with-more-than-32-characters");
  const preflightWarningReleaseGate = await runReleaseGateAllowFailure([
    "--mode", "full",
    "--environment", "preview",
    "--allow-process-env",
    "--url", "https://learnbuddy-preview.learnbuddy.cloud",
    "--lecture-token", "gleitlagerung-demo",
    "--skip-local",
    "--skip-readiness",
    "--skip-provider",
    "--skip-live",
    "--skip-worker"
  ], {
    DATABASE_URL: e2eDatabaseUrl,
    AUTH_SECRET: "learnbuddy-preview-secret-with-more-than-32-characters",
    LEARNBUDDY_MAIL_PROVIDER: "resend",
    RESEND_API_KEY: "re_live_like_abcdefghijklmnopqrstuvwxyz123456",
    EMAIL_FROM: "LearnBuddy <noreply@learnbuddy.cloud>",
    LEARNBUDDY_STORAGE_PROVIDER: "http",
    LEARNBUDDY_STORAGE_ENDPOINT: "https://storage.learnbuddy.cloud",
    LEARNBUDDY_JOB_PROVIDER: "database",
    LEARNBUDDY_WORKER_SECRET: "",
    CRON_SECRET: "",
    LEARNBUDDY_AI_PROVIDER: "openai-compatible",
    LEARNBUDDY_AI_BASE_URL: "http://127.0.0.1:3903",
    LEARNBUDDY_AI_API_KEY: "ai_secret",
    LEARNBUDDY_LECTURER_ASSISTANT_PROVIDER: "ai",
    LEARNBUDDY_CHAT_MODERATION_PROVIDER: "ai",
    LEARNBUDDY_QUESTION_GENERATOR: "ai",
    LEARNBUDDY_EMBEDDING_PROVIDER: "openai-compatible",
    LEARNBUDDY_EMBEDDING_BASE_URL: "https://embedding.learnbuddy.cloud",
    LEARNBUDDY_EMBEDDING_API_KEY: "embedding_secret",
    LEARNBUDDY_OCR_PROVIDER: "http",
    LEARNBUDDY_OCR_BASE_URL: "https://ocr.learnbuddy.cloud",
    LEARNBUDDY_OCR_API_KEY: "ocr_secret",
    LEARNBUDDY_STT_PROVIDER: "mistral-voxtral",
    MISTRAL_API_KEY: "mistral_secret"
  });
  expect(preflightWarningReleaseGate.ok).toBe(false);
  const adminPreflightBlocker = preflightWarningReleaseGate.blockers?.find((blocker) => blocker.id === "admin_preflight");
  expect(adminPreflightBlocker?.details?.childChecks?.map((child) => child.id)).toEqual(["ai_provider"]);
  expect(adminPreflightBlocker?.details?.childChecks?.some((child) => child.id === "job_provider")).toBe(false);
  const placeholderReadiness = await runDeployReadinessWithExactEnvAllowFailure(["--environment", "production", "--self-host"], {
    NEXT_PUBLIC_APP_URL: "https://learnbuddy-preview.learnbuddy.cloud",
    LEARNBUDDY_DEPLOYMENT_ENV: "production",
    AUTH_SECRET: "learnbuddy-production-secret-with-more-than-32-characters",
    DATABASE_URL: "postgres://learnbuddy:learnbuddy@db.learnbuddy.cloud:5432/learnbuddy",
    LEARNBUDDY_MAIL_PROVIDER: "resend",
    RESEND_API_KEY: "resend_test_key",
    EMAIL_FROM: "LearnBuddy <noreply@example.test>",
    LEARNBUDDY_STORAGE_PROVIDER: "http",
    LEARNBUDDY_STORAGE_ENDPOINT: "https://storage.example.test",
    LEARNBUDDY_JOB_PROVIDER: "database",
    LEARNBUDDY_WORKER_SECRET: "worker-secret-with-more-than-32-characters",
    CRON_SECRET: "cron-secret-with-more-than-32-characters",
    LEARNBUDDY_AI_PROVIDER: "ctox-responses",
    LEARNBUDDY_LLM_PROXY_API_KEY: "ctox_llm_mock_key",
    LEARNBUDDY_LECTURER_ASSISTANT_PROVIDER: "ai",
    LEARNBUDDY_CHAT_MODERATION_PROVIDER: "ai",
    LEARNBUDDY_QUESTION_GENERATOR: "ai",
    LEARNBUDDY_EMBEDDING_PROVIDER: "openai-compatible",
    LEARNBUDDY_EMBEDDING_BASE_URL: "https://embedding.example.test",
    LEARNBUDDY_EMBEDDING_API_KEY: "replace-with-embedding-key",
    LEARNBUDDY_OCR_PROVIDER: "http",
    LEARNBUDDY_OCR_BASE_URL: "https://ocr.example.test",
    LEARNBUDDY_OCR_API_KEY: "replace-with-ocr-key",
    LEARNBUDDY_STT_PROVIDER: "mistral-voxtral",
    MISTRAL_API_KEY: "replace-with-mistral-key"
  });
  expect(placeholderReadiness.ok).toBe(false);
  expect(
    (placeholderReadiness.checks ?? [])
      .some((check) => check.id === "provider_endpoint_values" && check.status === "fail")
  ).toBe(true);
  expect(
    (placeholderReadiness.checks ?? [])
      .some((check) => check.id === "placeholder_env_values" && check.status === "fail")
  ).toBe(true);
  expect(
    (placeholderReadiness.checks ?? [])
      .some((check) => check.id === "mail_sender_values" && check.status === "fail")
  ).toBe(true);
  expect(placeholderReadiness.blockers?.map((blocker) => blocker.id)).toEqual([
    "provider_endpoint_values",
    "placeholder_env_values",
    "mail_sender_values"
  ]);
  const fakeVercel = await createFakeVercelCli(`
NEXT_PUBLIC_APP_URL=https://learnbuddy-preview.learnbuddy.cloud
LEARNBUDDY_DEPLOYMENT_ENV=production
AUTH_SECRET=learnbuddy-production-secret-with-more-than-32-characters
DATABASE_URL=postgres://learnbuddy:learnbuddy@db.learnbuddy.cloud:5432/learnbuddy
LEARNBUDDY_MAIL_PROVIDER=resend
RESEND_API_KEY=resend_test_key
EMAIL_FROM=LearnBuddy <noreply@example.test>
LEARNBUDDY_STORAGE_PROVIDER=http
LEARNBUDDY_STORAGE_ENDPOINT=https://storage.example.test
LEARNBUDDY_JOB_PROVIDER=database
LEARNBUDDY_WORKER_SECRET=worker-secret-with-more-than-32-characters
CRON_SECRET=cron-secret-with-more-than-32-characters
LEARNBUDDY_AI_PROVIDER=ctox-responses
LEARNBUDDY_LLM_PROXY_API_KEY=ctox_llm_mock_key
LEARNBUDDY_LECTURER_ASSISTANT_PROVIDER=ai
LEARNBUDDY_CHAT_MODERATION_PROVIDER=ai
LEARNBUDDY_QUESTION_GENERATOR=ai
LEARNBUDDY_EMBEDDING_PROVIDER=openai-compatible
LEARNBUDDY_EMBEDDING_BASE_URL=https://embedding.example.test
LEARNBUDDY_EMBEDDING_API_KEY=replace-with-embedding-key
LEARNBUDDY_OCR_PROVIDER=http
LEARNBUDDY_OCR_BASE_URL=https://ocr.example.test
LEARNBUDDY_OCR_API_KEY=replace-with-ocr-key
LEARNBUDDY_STT_PROVIDER=mistral-voxtral
MISTRAL_API_KEY=replace-with-mistral-key
`);
  try {
    const listedVercelMissingReadiness = await withTemporaryVercelProjectLink(() => runDeployReadinessWithExactEnvAllowFailure([
      "--environment", "preview"
    ], {
      PATH: `${fakeVercel.binDir}${path.delimiter}${process.env.PATH ?? ""}`,
      HOME: process.env.HOME ?? "",
      NODE_ENV: "test"
    }));
    expect(listedVercelMissingReadiness.ok).toBe(false);
    const listedRequiredEnv = (listedVercelMissingReadiness.checks ?? [])
      .find((check) => check.id === "required_env");
    expect(listedRequiredEnv?.status).toBe("fail");
    const listedRemediation = listedRequiredEnv?.details?.remediation as {
      required?: Array<{ name?: string; command?: string; branchCommand?: string | null }>;
      alternativeGroups?: Array<{ id?: string; commands?: string[]; branchCommands?: string[] }>;
      completionGroups?: Array<{
        provider?: string;
        missingRequired?: Array<{ name?: string; branchCommand?: string | null }>;
        missingAlternativeGroups?: Array<{ id?: string; branchCommands?: string[] }>;
      }>;
      notes?: string[];
    } | undefined;
    expect(listedRemediation?.notes?.some((note) => note.includes("Vercel CLI 52"))).toBe(true);
    expect(listedRemediation?.required?.some((item) => (
      item.name === "RESEND_API_KEY" &&
      item.command === "vercel env add RESEND_API_KEY preview" &&
      item.branchCommand === "vercel env add RESEND_API_KEY preview <git-branch>"
    ))).toBe(true);
    expect(listedRemediation?.alternativeGroups?.some((group) => (
      group.id === "llm_proxy_key" &&
      group.commands?.includes("vercel env add LEARNBUDDY_LLM_PROXY_API_KEY preview") &&
      group.branchCommands?.includes("vercel env add LEARNBUDDY_LLM_PROXY_API_KEY preview <git-branch>")
    ))).toBe(true);
    expect(listedRemediation?.alternativeGroups?.some((group) => (
      group.id === "stt_provider_key" &&
      group.commands?.includes("vercel env add LEARNBUDDY_STT_API_KEY preview") &&
      group.branchCommands?.includes("vercel env add LEARNBUDDY_STT_API_KEY preview <git-branch>")
    ))).toBe(true);
    expect(listedRemediation?.completionGroups?.some((group) => (
      group.provider === "mail" &&
      group.missingRequired?.some((item) => (
        item.name === "RESEND_API_KEY" &&
        item.branchCommand === "vercel env add RESEND_API_KEY preview <git-branch>"
      ))
    ))).toBe(true);
    expect(listedRemediation?.completionGroups?.some((group) => (
      group.provider === "stt" &&
      group.missingAlternativeGroups?.some((item) => (
        item.id === "stt_provider_key" &&
        item.branchCommands?.includes("vercel env add LEARNBUDDY_STT_API_KEY preview <git-branch>")
      ))
    ))).toBe(true);
    const pulledVercelReadiness = await withTemporaryVercelProjectLink(() => runDeployReadinessWithExactEnvAllowFailure([
      "--environment", "production",
      "--pull-vercel-env"
    ], {
      PATH: `${fakeVercel.binDir}${path.delimiter}${process.env.PATH ?? ""}`,
      HOME: process.env.HOME ?? "",
      NODE_ENV: "test"
    }));
    expect(pulledVercelReadiness.ok).toBe(false);
    expect(
      (pulledVercelReadiness.checks ?? [])
        .some((check) => check.id === "vercel_env_pull" && check.status === "pass")
    ).toBe(true);
    expect(
      (pulledVercelReadiness.checks ?? [])
        .some((check) => check.id === "required_env" && check.status === "pass")
    ).toBe(true);
    expect(
      (pulledVercelReadiness.checks ?? [])
        .some((check) => check.id === "provider_endpoint_values" && check.status === "fail")
    ).toBe(true);
    expect(
      (pulledVercelReadiness.checks ?? [])
        .some((check) => check.id === "placeholder_env_values" && check.status === "fail")
    ).toBe(true);
    expect(
      (pulledVercelReadiness.checks ?? [])
        .some((check) => check.id === "mail_sender_values" && check.status === "fail")
    ).toBe(true);
    const pulledReadinessOutput = JSON.stringify(pulledVercelReadiness);
    expect(pulledReadinessOutput).not.toContain("resend_test_key");
    expect(pulledReadinessOutput).not.toContain("replace-with-embedding-key");
  } finally {
    await fakeVercel.cleanup();
  }
  const selfHostReadiness = await runDeployReadinessAllowFailure(["--environment", "production", "--self-host"], {
    NEXT_PUBLIC_APP_URL: "https://learnbuddy-preview.learnbuddy.cloud",
    LEARNBUDDY_DEPLOYMENT_ENV: "production",
    AUTH_SECRET: "learnbuddy-production-secret-with-more-than-32-characters",
    DATABASE_URL: "postgres://learnbuddy:learnbuddy@db.learnbuddy.cloud:5432/learnbuddy",
    LEARNBUDDY_MAIL_PROVIDER: "resend",
    RESEND_API_KEY: "re_live_like_abcdefghijklmnopqrstuvwxyz123456",
    EMAIL_FROM: "LearnBuddy <noreply@learnbuddy.cloud>",
    LEARNBUDDY_STORAGE_PROVIDER: "http",
    LEARNBUDDY_STORAGE_ENDPOINT: "https://storage.learnbuddy.cloud",
    LEARNBUDDY_JOB_PROVIDER: "database",
    LEARNBUDDY_WORKER_SECRET: "worker-secret-with-more-than-32-characters",
    CRON_SECRET: "cron-secret-with-more-than-32-characters",
    LEARNBUDDY_AI_PROVIDER: "ctox-responses",
    LEARNBUDDY_LLM_PROXY_API_KEY: "ctox_llm_live_like_abcdefghijklmnopqrstuvwxyz123456",
    LEARNBUDDY_LECTURER_ASSISTANT_PROVIDER: "ai",
    LEARNBUDDY_CHAT_MODERATION_PROVIDER: "ai",
    LEARNBUDDY_QUESTION_GENERATOR: "ai",
    LEARNBUDDY_EMBEDDING_PROVIDER: "openai-compatible",
    LEARNBUDDY_EMBEDDING_BASE_URL: "https://embedding.learnbuddy.cloud",
    LEARNBUDDY_EMBEDDING_API_KEY: "emb_live_like_abcdefghijklmnopqrstuvwxyz123456",
    LEARNBUDDY_OCR_PROVIDER: "http",
    LEARNBUDDY_OCR_BASE_URL: "https://ocr.learnbuddy.cloud",
    LEARNBUDDY_OCR_API_KEY: "ocr_live_like_abcdefghijklmnopqrstuvwxyz123456",
    LEARNBUDDY_STT_PROVIDER: "self-hosted-vllm",
    LEARNBUDDY_STT_BASE_URL: "https://stt.learnbuddy.cloud",
    LEARNBUDDY_STT_API_KEY: "stt_live_like_abcdefghijklmnopqrstuvwxyz123456",
    LEARNBUDDY_ALLOW_LOCAL_URL_FETCH: ""
  });
  expect(selfHostReadiness.ok).toBe(true);
  expect(selfHostReadiness.target).toBe("self-host");
  expect(
    (selfHostReadiness.checks ?? [])
      .some((check) => check.id === "self_hosting_files" && check.status === "pass")
  ).toBe(true);
  expect(
    (selfHostReadiness.checks ?? [])
      .some((check) => check.id === "env_example_contract" && check.status === "pass")
  ).toBe(true);
  expect(
    (selfHostReadiness.checks ?? [])
      .filter((check) => ["vercel_cli", "vercel_auth", "vercel_project_link"].includes(check.id ?? ""))
      .every((check) => check.status === "skip")
  ).toBe(true);
  expect(
    (selfHostReadiness.checks ?? [])
      .some((check) => check.id === "required_env" && check.status === "pass")
  ).toBe(true);
  const selfHostReleaseGate = await runReleaseGateAllowFailure([
    "--mode", "full",
    "--environment", "production",
    "--self-host",
    "--url", "https://learnbuddy-preview.learnbuddy.cloud",
    "--lecture-token", "gleitlagerung-demo",
    "--skip-local",
    "--skip-preflight",
    "--skip-provider",
    "--skip-live",
    "--skip-worker"
  ], {
    NEXT_PUBLIC_APP_URL: "https://learnbuddy-preview.learnbuddy.cloud",
    LEARNBUDDY_DEPLOYMENT_ENV: "production",
    AUTH_SECRET: "learnbuddy-production-secret-with-more-than-32-characters",
    DATABASE_URL: "postgres://learnbuddy:learnbuddy@db.learnbuddy.cloud:5432/learnbuddy",
    LEARNBUDDY_MAIL_PROVIDER: "resend",
    RESEND_API_KEY: "re_live_like_abcdefghijklmnopqrstuvwxyz123456",
    EMAIL_FROM: "LearnBuddy <noreply@learnbuddy.cloud>",
    LEARNBUDDY_STORAGE_PROVIDER: "http",
    LEARNBUDDY_STORAGE_ENDPOINT: "https://storage.learnbuddy.cloud",
    LEARNBUDDY_JOB_PROVIDER: "database",
    LEARNBUDDY_WORKER_SECRET: "worker-secret-with-more-than-32-characters",
    CRON_SECRET: "cron-secret-with-more-than-32-characters",
    LEARNBUDDY_AI_PROVIDER: "ctox-responses",
    LEARNBUDDY_LLM_PROXY_API_KEY: "ctox_llm_live_like_abcdefghijklmnopqrstuvwxyz123456",
    LEARNBUDDY_LECTURER_ASSISTANT_PROVIDER: "ai",
    LEARNBUDDY_CHAT_MODERATION_PROVIDER: "ai",
    LEARNBUDDY_QUESTION_GENERATOR: "ai",
    LEARNBUDDY_EMBEDDING_PROVIDER: "openai-compatible",
    LEARNBUDDY_EMBEDDING_BASE_URL: "https://embedding.learnbuddy.cloud",
    LEARNBUDDY_EMBEDDING_API_KEY: "emb_live_like_abcdefghijklmnopqrstuvwxyz123456",
    LEARNBUDDY_OCR_PROVIDER: "http",
    LEARNBUDDY_OCR_BASE_URL: "https://ocr.learnbuddy.cloud",
    LEARNBUDDY_OCR_API_KEY: "ocr_live_like_abcdefghijklmnopqrstuvwxyz123456",
    LEARNBUDDY_STT_PROVIDER: "self-hosted-vllm",
    LEARNBUDDY_STT_BASE_URL: "https://stt.learnbuddy.cloud",
    LEARNBUDDY_STT_API_KEY: "stt_live_like_abcdefghijklmnopqrstuvwxyz123456",
    LEARNBUDDY_ALLOW_LOCAL_URL_FETCH: ""
  });
  expect(selfHostReleaseGate.ok).toBe(false);
  expect(selfHostReleaseGate.releaseReady).toBe(false);
  expect(selfHostReleaseGate.target).toBe("self-host");
  expect(
    (selfHostReleaseGate.checks ?? [])
      .some((check) => check.id === "release_env_source" && check.status === "pass" && check.message?.includes("self-host"))
  ).toBe(true);
  expect(
    (selfHostReleaseGate.checks ?? [])
      .some((check) => check.id === "deploy_readiness" && check.status === "pass")
  ).toBe(true);
  const selfHostReleaseGateFromEnv = await runReleaseGateAllowFailure([
    "--mode", "full",
    "--environment", "production",
    "--url", "https://learnbuddy-preview.learnbuddy.cloud",
    "--lecture-token", "gleitlagerung-demo",
    "--skip-local",
    "--skip-preflight",
    "--skip-provider",
    "--skip-live",
    "--skip-worker"
  ], {
    NEXT_PUBLIC_APP_URL: "https://learnbuddy-preview.learnbuddy.cloud",
    LEARNBUDDY_RELEASE_GATE_SELF_HOST: "1",
    LEARNBUDDY_DEPLOYMENT_ENV: "production",
    AUTH_SECRET: "learnbuddy-production-secret-with-more-than-32-characters",
    DATABASE_URL: "postgres://learnbuddy:learnbuddy@db.learnbuddy.cloud:5432/learnbuddy",
    LEARNBUDDY_MAIL_PROVIDER: "resend",
    RESEND_API_KEY: "re_live_like_abcdefghijklmnopqrstuvwxyz123456",
    EMAIL_FROM: "LearnBuddy <noreply@learnbuddy.cloud>",
    LEARNBUDDY_STORAGE_PROVIDER: "http",
    LEARNBUDDY_STORAGE_ENDPOINT: "https://storage.learnbuddy.cloud",
    LEARNBUDDY_JOB_PROVIDER: "database",
    LEARNBUDDY_WORKER_SECRET: "worker-secret-with-more-than-32-characters",
    CRON_SECRET: "cron-secret-with-more-than-32-characters",
    LEARNBUDDY_AI_PROVIDER: "ctox-responses",
    LEARNBUDDY_LLM_PROXY_API_KEY: "ctox_llm_live_like_abcdefghijklmnopqrstuvwxyz123456",
    LEARNBUDDY_LECTURER_ASSISTANT_PROVIDER: "ai",
    LEARNBUDDY_CHAT_MODERATION_PROVIDER: "ai",
    LEARNBUDDY_QUESTION_GENERATOR: "ai",
    LEARNBUDDY_EMBEDDING_PROVIDER: "openai-compatible",
    LEARNBUDDY_EMBEDDING_BASE_URL: "https://embedding.learnbuddy.cloud",
    LEARNBUDDY_EMBEDDING_API_KEY: "emb_live_like_abcdefghijklmnopqrstuvwxyz123456",
    LEARNBUDDY_OCR_PROVIDER: "http",
    LEARNBUDDY_OCR_BASE_URL: "https://ocr.learnbuddy.cloud",
    LEARNBUDDY_OCR_API_KEY: "ocr_live_like_abcdefghijklmnopqrstuvwxyz123456",
    LEARNBUDDY_STT_PROVIDER: "self-hosted-vllm",
    LEARNBUDDY_STT_BASE_URL: "https://stt.learnbuddy.cloud",
    LEARNBUDDY_STT_API_KEY: "stt_live_like_abcdefghijklmnopqrstuvwxyz123456",
    LEARNBUDDY_ALLOW_LOCAL_URL_FETCH: ""
  });
  expect(selfHostReleaseGateFromEnv.ok).toBe(false);
  expect(selfHostReleaseGateFromEnv.releaseReady).toBe(false);
  expect(selfHostReleaseGateFromEnv.target).toBe("self-host");
  expect(
    (selfHostReleaseGateFromEnv.checks ?? [])
      .some((check) => check.id === "release_env_source" && check.status === "pass" && check.message?.includes("self-host"))
  ).toBe(true);
  expect(
    (selfHostReleaseGateFromEnv.checks ?? [])
      .some((check) => check.id === "deploy_readiness" && check.status === "pass")
  ).toBe(true);
  const selfHostReleaseGateWithVercelPull = await runReleaseGateAllowFailure([
    "--mode", "full",
    "--environment", "production",
    "--self-host",
    "--pull-vercel-env",
    "--url", "https://learnbuddy-preview.learnbuddy.cloud",
    "--lecture-token", "gleitlagerung-demo",
    "--skip-local",
    "--skip-readiness",
    "--skip-preflight",
    "--skip-provider",
    "--skip-live",
    "--skip-worker"
  ], {
    NEXT_PUBLIC_APP_URL: "https://learnbuddy-preview.learnbuddy.cloud",
    LEARNBUDDY_DEPLOYMENT_ENV: "production",
    AUTH_SECRET: "learnbuddy-production-secret-with-more-than-32-characters",
    DATABASE_URL: "postgres://learnbuddy:learnbuddy@db.learnbuddy.cloud:5432/learnbuddy",
    LEARNBUDDY_MAIL_PROVIDER: "resend",
    RESEND_API_KEY: "re_live_like_abcdefghijklmnopqrstuvwxyz123456",
    EMAIL_FROM: "LearnBuddy <noreply@learnbuddy.cloud>",
    LEARNBUDDY_STORAGE_PROVIDER: "http",
    LEARNBUDDY_STORAGE_ENDPOINT: "https://storage.learnbuddy.cloud",
    LEARNBUDDY_JOB_PROVIDER: "database",
    LEARNBUDDY_WORKER_SECRET: "worker-secret-with-more-than-32-characters",
    CRON_SECRET: "cron-secret-with-more-than-32-characters",
    LEARNBUDDY_AI_PROVIDER: "ctox-responses",
    LEARNBUDDY_LLM_PROXY_API_KEY: "ctox_llm_live_like_abcdefghijklmnopqrstuvwxyz123456",
    LEARNBUDDY_LECTURER_ASSISTANT_PROVIDER: "ai",
    LEARNBUDDY_CHAT_MODERATION_PROVIDER: "ai",
    LEARNBUDDY_QUESTION_GENERATOR: "ai",
    LEARNBUDDY_EMBEDDING_PROVIDER: "openai-compatible",
    LEARNBUDDY_EMBEDDING_BASE_URL: "https://embedding.learnbuddy.cloud",
    LEARNBUDDY_EMBEDDING_API_KEY: "emb_live_like_abcdefghijklmnopqrstuvwxyz123456",
    LEARNBUDDY_OCR_PROVIDER: "http",
    LEARNBUDDY_OCR_BASE_URL: "https://ocr.learnbuddy.cloud",
    LEARNBUDDY_OCR_API_KEY: "ocr_live_like_abcdefghijklmnopqrstuvwxyz123456",
    LEARNBUDDY_STT_PROVIDER: "self-hosted-vllm",
    LEARNBUDDY_STT_BASE_URL: "https://stt.learnbuddy.cloud",
    LEARNBUDDY_STT_API_KEY: "stt_live_like_abcdefghijklmnopqrstuvwxyz123456",
    LEARNBUDDY_ALLOW_LOCAL_URL_FETCH: ""
  });
  expect(selfHostReleaseGateWithVercelPull.ok).toBe(false);
  expect(selfHostReleaseGateWithVercelPull.releaseReady).toBe(false);
  expect(selfHostReleaseGateWithVercelPull.target).toBe("self-host");
  expect(
    (selfHostReleaseGateWithVercelPull.checks ?? [])
      .some((check) => check.id === "release_env_source" && check.status === "fail" && check.message?.includes("cannot pull Vercel env"))
  ).toBe(true);
  const selfHostSmokeWithoutDocker = await runSelfHostSmokeAllowFailure(["--config-only"], {
    PATH: ""
  });
  expect(selfHostSmokeWithoutDocker.ok).toBe(false);
  expect(
    (selfHostSmokeWithoutDocker.checks ?? [])
      .some((check) => check.id === "docker_cli" && check.status === "fail" && check.message?.includes("Docker CLI is not available"))
  ).toBe(true);
  expect(selfHostSmokeWithoutDocker.blockers?.map((blocker) => blocker.id)).toEqual(["docker_cli"]);
  const missingSourceBackupRestoreSmoke = await runBackupRestoreSmokeAllowFailure(["--timeout-ms", "1000"], {
    PG_DUMP_BIN: process.execPath,
    PSQL_BIN: process.execPath
  });
  expect(missingSourceBackupRestoreSmoke.ok).toBe(false);
  expect(
    (missingSourceBackupRestoreSmoke.checks ?? [])
      .some((check) => check.id === "source_database" && check.status === "fail")
  ).toBe(true);
  expect(missingSourceBackupRestoreSmoke.blockers?.map((blocker) => blocker.id)).toEqual(["source_database"]);
  const privateReleaseTargetGate = await runReleaseGateAllowFailure([
    "--mode", "full",
    "--environment", "preview",
    "--allow-process-env",
    "--url", "https://100.64.0.1",
    "--lecture-token", "gleitlagerung-demo",
    "--skip-local",
    "--skip-readiness",
    "--skip-preflight",
    "--skip-provider",
    "--skip-live",
    "--skip-worker"
  ]);
  expect(privateReleaseTargetGate.ok).toBe(false);
  expect(privateReleaseTargetGate.releaseReady).toBe(false);
  expect(
    (privateReleaseTargetGate.checks ?? [])
      .some((check) => check.id === "release_target" && check.status === "fail" && check.message?.includes("private network targets"))
  ).toBe(true);
  const reservedReleaseTargetGate = await runReleaseGateAllowFailure([
    "--mode", "full",
    "--environment", "preview",
    "--allow-process-env",
    "--url", "https://preview.example.test",
    "--lecture-token", "gleitlagerung-demo",
    "--skip-local",
    "--skip-readiness",
    "--skip-preflight",
    "--skip-provider",
    "--skip-live",
    "--skip-worker"
  ]);
  expect(reservedReleaseTargetGate.ok).toBe(false);
  expect(reservedReleaseTargetGate.releaseReady).toBe(false);
  expect(
    (reservedReleaseTargetGate.checks ?? [])
      .some((check) => check.id === "release_target" && check.status === "fail" && check.message?.includes("reserved example or test targets"))
  ).toBe(true);
  const relativeMagicLinkLiveSmoke = await runLiveSmokeAllowFailure([
    "--url", "https://preview.example.test",
    "--lecture-token", "gleitlagerung-demo",
    "--require-auth",
    "--magic-link", "/auth/magic?token=abc",
    "--timeout-ms", "1000"
  ]);
  expect(relativeMagicLinkLiveSmoke.ok).toBe(false);
  expect(
    (relativeMagicLinkLiveSmoke.checks ?? [])
      .some((check) => check.id === "live_auth_precondition" && check.status === "fail" && check.message?.includes("absolute HTTPS magic link"))
  ).toBe(true);
  expect(relativeMagicLinkLiveSmoke.blockers?.map((blocker) => blocker.id)).toEqual(["live_auth_precondition"]);
  const publicHttpLiveSmoke = await runLiveSmokeAllowFailure([
    "--url", "http://preview.example.test",
    "--lecture-token", "gleitlagerung-demo",
    "--timeout-ms", "1000"
  ]);
  expect(publicHttpLiveSmoke.ok).toBe(false);
  expect(
    (publicHttpLiveSmoke.checks ?? [])
      .some((check) => check.id === "live_target" && check.status === "fail" && check.message?.includes("HTTPS app URL"))
  ).toBe(true);
  expect(publicHttpLiveSmoke.blockers?.map((blocker) => blocker.id)).toEqual(["live_target"]);
  const publicHttpWorkerSmoke = await runWorkerSmokeAllowFailure([
    "--url", "http://preview.example.test",
    "--verify-job-id", "unused",
    "--timeout-ms", "1000"
  ]);
  expect(publicHttpWorkerSmoke.ok).toBe(false);
  expect(
    (publicHttpWorkerSmoke.checks ?? [])
      .some((check) => check.id === "worker_target" && check.status === "fail" && check.message?.includes("HTTPS app URL"))
  ).toBe(true);
  expect(publicHttpWorkerSmoke.blockers?.map((blocker) => blocker.id)).toEqual(["worker_target"]);
  const publicHttpLiveLoadSmoke = await runLiveLoadSmokeAllowFailure([
    "--url", "http://preview.example.test",
    "--lecture-token", "gleitlagerung-demo",
    "--participants", "1",
    "--timeout-ms", "1000"
  ]);
  expect(publicHttpLiveLoadSmoke.ok).toBe(false);
  expect(
    (publicHttpLiveLoadSmoke.checks ?? [])
      .some((check) => check.id === "live_load_target" && check.status === "fail" && check.message?.includes("HTTPS app URL"))
  ).toBe(true);
  expect(publicHttpLiveLoadSmoke.blockers?.map((blocker) => blocker.id)).toEqual(["live_load_target"]);
  const absoluteStorageJobSql = postgres(e2eDatabaseUrl, { max: 1, prepare: false });
  let absoluteStorageExportId = "";
  let absoluteStorageJobId = "";
  try {
    const [lecture] = await absoluteStorageJobSql<{ id: string }[]>`
      select id from lectures where public_token = 'gleitlagerung-demo'
    `;
    expect(lecture?.id).toBeTruthy();
    const sha = "a".repeat(64);
    const absoluteStorageUrl = "http://127.0.0.1:3999/archive.zip";
    const [createdExport] = await absoluteStorageJobSql<{ id: string }[]>`
      insert into standalone_exports (lecture_id, version, storage_url, sha256, created_at)
      values (${lecture.id}, 'worker-smoke-e2e', ${absoluteStorageUrl}, ${sha}, now())
      returning id
    `;
    absoluteStorageExportId = createdExport.id;
    const [createdJob] = await absoluteStorageJobSql<{ id: string }[]>`
      insert into standalone_export_jobs (
        lecture_id,
        status,
        format,
        requested_by,
        standalone_export_id,
        storage_url,
        sha256,
        provider,
        provider_job_id,
        attempt_count,
        max_attempts,
        completed_at
      )
      values (
        ${lecture.id},
        'succeeded',
        'archive_zip',
        'worker-smoke-absolute-url-e2e',
        ${absoluteStorageExportId},
        ${absoluteStorageUrl},
        ${sha},
        'database',
        'worker-smoke-absolute-url-e2e',
        1,
        1,
        now()
      )
      returning id
    `;
    absoluteStorageJobId = createdJob.id;
    const absoluteStorageWorkerSmoke = await runWorkerSmokeAllowFailure([
      "--url", e2eBaseUrl,
      "--verify-job-id", absoluteStorageJobId,
      "--timeout-ms", "1000"
    ]);
    expect(absoluteStorageWorkerSmoke.ok).toBe(false);
    expect(
      (absoluteStorageWorkerSmoke.checks ?? [])
        .some((check) => check.id === "worker_smoke" && check.status === "fail" && check.message?.includes("app-internal artifact route"))
    ).toBe(true);
    expect(absoluteStorageWorkerSmoke.blockers?.map((blocker) => blocker.id)).toEqual(["worker_smoke"]);
  } finally {
    if (absoluteStorageJobId) {
      await absoluteStorageJobSql`
        delete from standalone_export_jobs where id = ${absoluteStorageJobId}
      `;
    }
    if (absoluteStorageExportId) {
      await absoluteStorageJobSql`
        delete from standalone_exports where id = ${absoluteStorageExportId}
      `;
    }
    await absoluteStorageJobSql.end();
  }
  const unsupportedPublicEvent = await page.request.post("/api/events", {
    data: {
      lectureToken: "gleitlagerung-demo",
      eventType: "debug_dump",
      anonymousKey: "unsupported-event-e2e",
      pseudonym: "Event Guard",
      payload: { mode: "live" }
    }
  });
  expect(unsupportedPublicEvent.status()).toBe(400);
  const invalidTokenPublicEvent = await page.request.post("/api/events", {
    data: {
      lectureToken: invalidToken,
      eventType: "student_joined",
      anonymousKey: "invalid-token-event-e2e",
      pseudonym: "Token Guard",
      payload: { mode: "live" }
    }
  });
  expect(invalidTokenPublicEvent.status()).toBe(400);

  await page.goto(`/auth/magic?token=${"x".repeat(2000)}`);
  await expect(page).toHaveURL(/\/lecturer\/login\?error=invalid-token$/);
  await expect(page.getByText("Dieser Magic Link ist abgelaufen oder wurde bereits verwendet.")).toBeVisible();

  const oversizedPublicEvent = await page.request.post("/api/events", {
    data: {
      lectureToken: "gleitlagerung-demo",
      eventType: "evaluation_submitted",
      anonymousKey: "oversized-event-e2e",
      pseudonym: "Event Guard",
      payload: {
        understanding: 4,
        pace: 4,
        aiHelpful: 4,
        comment: "x".repeat(20_000)
      }
    }
  });
  expect(oversizedPublicEvent.status()).toBe(413);
  const spoofedAnswer = await page.request.post("/api/events", {
    data: {
      lectureToken: "gleitlagerung-demo",
      eventType: "answer_selected",
      anonymousKey: "spoofed-answer-e2e",
      pseudonym: "Event Guard",
      payload: {
        mode: "live",
        level: "4.0",
        selected: "A",
        selectedAnswerKey: "A",
        points: 999,
        correct: true
      }
    }
  });
  expect(spoofedAnswer.ok()).toBe(true);
  const spoofedPayload = await spoofedAnswer.json() as {
    event?: {
      payload?: {
        correct?: boolean;
        points?: number;
        earnedPoints?: number;
        selectedAnswerKey?: string;
        correctAnswerKey?: string;
      };
    };
  };
  expect(spoofedPayload.event?.payload).toMatchObject({
    correct: false,
    points: 1,
    earnedPoints: 0,
    selectedAnswerKey: "A",
    correctAnswerKey: "B"
  });

  const exportCountSql = postgres(e2eDatabaseUrl, { max: 1, prepare: false });
  let publicExportCountBefore = 0;
  try {
    const [row] = await exportCountSql<{ count: number }[]>`
      select count(*)::int as count
      from standalone_exports
      where storage_url = '/api/lecture/gleitlagerung-demo/export'
    `;
    publicExportCountBefore = row.count;
  } finally {
    await exportCountSql.end();
  }
  const publicExport = await page.request.get("/api/lecture/gleitlagerung-demo/export");
  expect(publicExport.ok()).toBe(true);
  expect(publicExport.headers()["content-type"]).toContain("text/html");
  const publicExportAfterSql = postgres(e2eDatabaseUrl, { max: 1, prepare: false });
  try {
    const [row] = await publicExportAfterSql<{ count: number }[]>`
      select count(*)::int as count
      from standalone_exports
      where storage_url = '/api/lecture/gleitlagerung-demo/export'
    `;
    expect(row.count).toBe(publicExportCountBefore);
  } finally {
    await publicExportAfterSql.end();
  }

  const magicLink = await loginLecturer(page);
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((cookie) => cookie.name === lecturerSessionCookie);
  expect(sessionCookie?.httpOnly).toBe(true);
  expect(sessionCookie?.sameSite).toBe("Lax");
  const sessionPayload = decodeTestPayload<{ email?: string; issuedAt?: string; expiresAt?: number }>(sessionCookie?.value ?? "");
  expect(sessionPayload.email).toBe("e2e@example.test");
  expect(sessionPayload.issuedAt).toBeTruthy();
  expect(sessionPayload.expiresAt).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);
  await expectMagicLinkCannotBeReused(browser, magicLink);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Vorlesungsreihe" })).toContainText("Maschinenelemente I");

  const lecturesResponse = await page.request.get("/api/lectures");
  expect(lecturesResponse.ok()).toBe(true);
  const lecturesPayload = await lecturesResponse.json() as {
    lectures?: Array<{
      id: string;
      title: string;
      learnQuestionDensity?: number;
      slides: Array<{ id: string }>;
      assistantMessages?: Array<{
        role: "lecturer" | "assistant";
        content: string;
        metadata?: {
          provider?: string;
          model?: string;
          toolPlan?: Array<{ action?: string; label?: string; order?: number; status?: string }>;
        };
      }>;
    }>;
  };
  const lecture = lecturesPayload.lectures?.find((item) => item.title === "Gleitlagerung");
  expect(lecture).toBeTruthy();
  const authenticatedExportBeforeSql = postgres(e2eDatabaseUrl, { max: 1, prepare: false });
  let authenticatedExportCountBefore = 0;
  try {
    const [row] = await authenticatedExportBeforeSql<{ count: number }[]>`
      select count(*)::int as count
      from standalone_exports
      where storage_url = '/api/lecture/gleitlagerung-demo/export'
    `;
    authenticatedExportCountBefore = row.count;
  } finally {
    await authenticatedExportBeforeSql.end();
  }
  const authenticatedExport = await page.request.get("/api/lecture/gleitlagerung-demo/export");
  expect(authenticatedExport.ok()).toBe(true);
  const authenticatedExportAfterSql = postgres(e2eDatabaseUrl, { max: 1, prepare: false });
  try {
    const [row] = await authenticatedExportAfterSql<{ count: number }[]>`
      select count(*)::int as count
      from standalone_exports
      where storage_url = '/api/lecture/gleitlagerung-demo/export'
    `;
    expect(row.count).toBe(authenticatedExportCountBefore + 1);
  } finally {
    await authenticatedExportAfterSql.end();
  }

  const csrfToken = await lecturerCsrfToken(page);
  const invalidLecturerLivePage = await page.request.get(`/lecturer/live/${invalidToken}`);
  expect(invalidLecturerLivePage.status()).toBe(404);
  const invalidEntityId = "entity_" + "x".repeat(120);
  const invalidAggregatesResponse = await page.request.get(`/api/lectures/${invalidEntityId}/aggregates`);
  expect(invalidAggregatesResponse.status()).toBe(404);
  const invalidAssistantEntityResponse = await page.request.post(`/api/lectures/${invalidEntityId}/assistant`, {
    headers: { "x-learnbuddy-csrf": csrfToken },
    data: {
      message: "Diese Anfrage darf keinen Repository-Lookup mit ungültiger ID auslösen.",
      slideId: lecture!.slides[0]?.id
    }
  });
  expect(invalidAssistantEntityResponse.status()).toBe(404);
  const invalidReviewEntityResponse = await page.request.patch(`/api/lectures/${lecture!.id}/question-reviews/${invalidEntityId}`, {
    headers: { "x-learnbuddy-csrf": csrfToken },
    data: { decision: "approved" }
  });
  expect(invalidReviewEntityResponse.status()).toBe(404);
  const invalidChatModerationEntityResponse = await page.request.patch(`/api/lectures/${lecture!.id}/chat-questions/${invalidEntityId}`, {
    headers: { "x-learnbuddy-csrf": csrfToken },
    data: { status: "ignored" }
  });
  expect(invalidChatModerationEntityResponse.status()).toBe(404);

  const oversizedAssistantResponse = await page.request.post(`/api/lectures/${lecture!.id}/assistant`, {
    headers: { "x-learnbuddy-csrf": csrfToken },
    data: {
      message: "x".repeat(9000),
      slideId: lecture!.slides[0]?.id
    }
  });
  expect(oversizedAssistantResponse.status()).toBe(413);

  const oversizedMaterialResponse = await page.request.post(`/api/lectures/${lecture!.id}/materials`, {
    headers: { "x-learnbuddy-csrf": csrfToken },
    multipart: {
      file: {
        name: "too-large-e2e.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.alloc(1_400_000)
      }
    }
  });
  expect(oversizedMaterialResponse.status()).toBe(413);
  const oversizedMaterialPayload = await oversizedMaterialResponse.json() as { code?: string; maxBytes?: number; sizeBytes?: number };
  expect(oversizedMaterialPayload.code).toBe("material_request_too_large");
  expect(oversizedMaterialPayload.maxBytes).toBe(1_048_576 + 256 * 1024);
  expect(oversizedMaterialPayload.sizeBytes).toBeGreaterThan(oversizedMaterialPayload.maxBytes ?? 0);

  const oversizedSttResponse = await page.request.post(`/api/lectures/${lecture!.id}/stt`, {
    headers: { "x-learnbuddy-csrf": csrfToken },
    multipart: {
      audio: {
        name: "too-large-e2e.wav",
        mimeType: "audio/wav",
        buffer: Buffer.alloc(5_100_000)
      },
      slideTopic: "Gleitlagerung"
    }
  });
  expect(oversizedSttResponse.status()).toBe(413);

  const invalidSttTimestampResponse = await page.request.post(`/api/lectures/${lecture!.id}/stt`, {
    headers: { "x-learnbuddy-csrf": csrfToken },
    multipart: {
      audio: {
        name: "invalid-time-e2e.webm",
        mimeType: "audio/webm",
        buffer: Buffer.from("small-audio-e2e")
      },
      slideTopic: "Gleitlagerung",
      startedAt: "not-a-date",
      endedAt: new Date().toISOString()
    }
  });
  expect(invalidSttTimestampResponse.status()).toBe(400);

  const tooLongTranscriptSegmentResponse = await page.request.post(`/api/lectures/${lecture!.id}/transcript-segments`, {
    headers: { "x-learnbuddy-csrf": csrfToken },
    data: {
      text: "Mischreibung ist beim Anlauf kritisch, weil der Schmierfilm noch nicht voll trägt.",
      provider: "voxtral-realtime",
      startedAt: new Date(Date.now() - 16 * 60 * 1000).toISOString(),
      endedAt: new Date().toISOString()
    }
  });
  expect(tooLongTranscriptSegmentResponse.status()).toBe(400);

  const missingCsrfResponse = await page.request.post(`/api/lectures/${lecture!.id}/assistant`, {
    data: {
      message: "Dieser schreibende Request muss ohne CSRF-Token scheitern.",
      slideId: lecture!.slides[0]?.id
    }
  });
  expect(missingCsrfResponse.status()).toBe(403);
  const missingPlanCsrfResponse = await page.request.post(`/api/lectures/${lecture!.id}/assistant/apply-plan`, {
    data: {
      slideId: lecture!.slides[0]?.id
    }
  });
  expect(missingPlanCsrfResponse.status()).toBe(403);
  const missingEvaluationCsrfResponse = await page.request.post(`/api/lectures/${lecture!.id}/assistant/evaluation-focus`, {
    data: {
      slideId: lecture!.slides[0]?.id,
      message: "Diese Evaluation darf ohne CSRF-Token nicht geändert werden."
    }
  });
  expect(missingEvaluationCsrfResponse.status()).toBe(403);
  const missingLearnDensityCsrfResponse = await page.request.post(`/api/lectures/${lecture!.id}/assistant/learn-density`, {
    data: {
      slideId: lecture!.slides[0]?.id,
      message: "Diese Learn-Fragedichte darf ohne CSRF-Token nicht geändert werden."
    }
  });
  expect(missingLearnDensityCsrfResponse.status()).toBe(403);
  const assistantResponse = await page.request.post(`/api/lectures/${lecture!.id}/assistant`, {
    headers: { "x-learnbuddy-csrf": csrfToken },
    data: {
      message: "Welche nächste didaktische Aktion passt zu dieser Folie?",
      slideId: lecture!.slides[0]?.id
    }
  });
  expect(assistantResponse.ok()).toBe(true);
  const assistantPayload = await assistantResponse.json() as { lecture?: typeof lecture };
  const assistantMessage = assistantPayload.lecture?.assistantMessages?.find((message) => message.role === "assistant");
  expect(assistantMessage?.metadata?.provider).toBe("openai-compatible");
  expect(assistantMessage?.metadata?.model).toBe("mock-e2e-chat");
  expect(assistantMessage?.metadata?.toolPlan?.[0]?.action).toBe("slide_point");
  expect(assistantMessage?.metadata?.toolPlan?.[1]?.action).toBe("review_draft");
  expect(assistantMessage?.content).toContain("Mock-Erklärung");

  await page.getByRole("button", { name: "Assistent an dieser Folie" }).click();
  await expect(page.getByLabel("Planungsassistent direkt an der Folie")).toBeVisible();
  await page.getByLabel("Nachricht an den Planungsassistenten").fill("Welche Erklärung passt direkt auf diese Folie?");
  await page.getByRole("button", { name: "Senden" }).click();
  await expect(page.getByText("Mock-Erklärung").last()).toBeVisible();
  await expect(page.getByLabel("Agent-Schritte").last()).toContainText("AIProvider genutzt");
  await expect(page.getByLabel("Nächste Agent-Aktionen").last()).toContainText("1. Folienpunkt übernehmen");
  await expect(page.getByLabel("Nächste Agent-Aktionen").last()).toContainText("2. Fragenentwurf anlegen");
  await expect(page.getByRole("button", { name: "Toolkette ausführen" })).toBeVisible();
  await expect(page.getByRole("button", { name: "1. Folienpunkt übernehmen" })).toBeVisible();
  await expect(page.getByRole("button", { name: "2. Fragenentwurf" })).toBeVisible();
  await page.getByRole("button", { name: "Toolkette ausführen" }).click();
  await expect(page.getByText("Ich habe diesen Folienpunkt").last()).toBeVisible();
  await expect(page.getByText("Ich habe einen Fragenentwurf").last()).toBeVisible();
  await page.getByLabel("Nachricht an den Planungsassistenten").fill("Bitte schärfe die Evaluation auf diese Folie.");
  await page.getByRole("button", { name: "Senden" }).click();
  await expect(page.getByLabel("Nächste Agent-Aktionen").last()).toContainText("1. Evaluation schärfen");
  await page.getByRole("button", { name: "1. Evaluation schärfen" }).click();
  await expect(page.getByText("Ich habe die Evaluation").last()).toBeVisible();
  await expect(page.getByLabel("Evaluation direkt auf der Folie")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Evaluationstitel" })).toHaveValue(/Evaluation: Stribeck-Kurve/);
  await page.getByRole("button", { name: "Evaluation schließen" }).click();
  await expect(page.getByLabel("Evaluation direkt auf der Folie")).toBeHidden();
  await page.getByRole("button", { name: "Assistent an dieser Folie" }).click();
  await expect(page.getByLabel("Planungsassistent direkt an der Folie")).toBeVisible();
  await page.getByLabel("Nachricht an den Planungsassistenten").fill("Bitte erhöhe die Fragedichte im Learn-Modus für die Nacharbeit.");
  await page.getByRole("button", { name: "Senden" }).click();
  await expect(page.getByLabel("Nächste Agent-Aktionen").last()).toContainText("1. Learn-Fragedichte setzen");
  await expect(page.getByRole("button", { name: "1. Fragedichte setzen" })).toBeVisible();
  await page.getByRole("button", { name: "1. Fragedichte setzen" }).click();
  await expect(page.getByText("Ich habe die Learn-Fragedichte auf 6").last()).toBeVisible();
  const learnDensitySql = postgres(e2eDatabaseUrl, { max: 1, prepare: false });
  try {
    const [row] = await learnDensitySql<{ density: number }[]>`
      select learn_question_density as density
      from lectures
      where public_token = 'gleitlagerung-demo'
    `;
    expect(row.density).toBe(6);
  } finally {
    await learnDensitySql.end();
  }
  const resetLearnDensityResponse = await page.request.patch(`/api/lectures/${lecture!.id}`, {
    headers: { "x-learnbuddy-csrf": csrfToken },
    data: { learnQuestionDensity: 4 }
  });
  expect(resetLearnDensityResponse.ok()).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: "Assistent an dieser Folie" }).click();
  await expect(page.getByText("Mock-Erklärung").last()).toBeVisible();
  await expect(page.getByLabel("Planungsassistent direkt an der Folie")).toContainText("Ich habe die Learn-Fragedichte auf 6");
  await page.getByLabel("Assistent schließen").click();
  await page.getByRole("button", { name: "Evaluation im Learn-Modus" }).click();
  await expect(page.getByRole("textbox", { name: "Evaluationstitel" })).toHaveValue(/Evaluation: Stribeck-Kurve/);
  await page.getByLabel("Evaluation schließen").click();

  await page.getByRole("button", { name: /Fragen auf dieser Folie/ }).click();
  await expect(page.getByLabel("Fragen direkt auf der Folie")).toBeVisible();
  await expect(page.getByLabel("Fragenvorschläge").getByText("Assistent: Hydrodynamische Gleitlagerung")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Fragetext Niveau 2.0" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Fragetext Niveau 2.0" })).toContainText(/Warum ist Mischreibung beim Anlauf eines Gleitlagers kritisch/);

  await page.getByLabel("Studio-Menü").click();
  await page.getByRole("link", { name: "Logout" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/lecturer");
  await expect(page).toHaveURL(/\/lecturer\/login$/);
  await expectExpiredSessionCookieIsRejected(page);
  assertClean();
});

test("Standalone-ZIP-Manifest passt zu allen Archiv-Einträgen", async ({ page }) => {
  const response = await page.request.get("/api/lecture/gleitlagerung-demo/export?format=zip&record=0");
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("application/zip");

  const zipBytes = Buffer.from(await response.body());
  expect(response.headers()["x-learnbuddy-sha256"]).toBe(sha256Hex(zipBytes));

  const entries = parseStoredZipEntries(zipBytes);
  const manifestBytes = entries.get("learnbuddy-manifest.json");
  if (!manifestBytes) throw new Error("ZIP export is missing learnbuddy-manifest.json.");
  expect(response.headers()["x-learnbuddy-manifest-sha256"]).toBe(sha256Hex(manifestBytes));

  const manifest = JSON.parse(manifestBytes.toString("utf8")) as {
    archiveSchemaVersion?: string;
    rootDocument?: string;
    selfContained?: boolean;
    externalAssetCount?: number;
    slideEngine?: { renderer?: string; slideDocumentSchemaVersion?: string; slideDocumentId?: string };
    integrity?: { payloadSha256?: string };
    audioSegments?: Array<{ path?: string; sha256?: string; bytes?: number }>;
    assets?: Array<{ path?: string; role?: string; bytes?: number; sha256?: string }>;
  };
  expect(manifest.archiveSchemaVersion).toBe("standalone-archive-v1");
  expect(manifest.rootDocument).toBe("index.html");
  expect(manifest.selfContained).toBe(true);
  expect(manifest.externalAssetCount).toBe(0);
  expect(manifest.slideEngine).toMatchObject({
    renderer: "learnordie-slide-standalone-v1",
    slideDocumentSchemaVersion: "learnordie.slide.v1"
  });
  expect(manifest.slideEngine?.slideDocumentId).toMatch(/^lecture:[^:]+:deck$/);

  const assetPaths = new Set((manifest.assets ?? []).map((asset) => asset.path));
  for (const requiredPath of [
    "index.html",
    "learnbuddy-data.json",
    "assets/styles.css",
    "assets/standalone.js",
    "audio/dozenten-audio-fallback.wav"
  ]) {
    expect(assetPaths.has(requiredPath)).toBe(true);
  }

  for (const asset of manifest.assets ?? []) {
    if (!asset.path) throw new Error("Manifest asset is missing path.");
    const entry = entries.get(asset.path);
    if (!entry) throw new Error(`ZIP export is missing manifest asset ${asset.path}.`);
    expect(entry.length).toBe(asset.bytes);
    expect(sha256Hex(entry)).toBe(asset.sha256);
  }

  expect((manifest.audioSegments ?? []).length).toBeGreaterThan(0);
  for (const segment of manifest.audioSegments ?? []) {
    if (!segment.path) throw new Error("Manifest audio segment is missing path.");
    const entry = entries.get(segment.path);
    if (!entry) throw new Error(`ZIP export is missing audio segment ${segment.path}.`);
    expect(entry.length).toBe(segment.bytes);
    expect(sha256Hex(entry)).toBe(segment.sha256);
  }

  const dataBytes = entries.get("learnbuddy-data.json");
  if (!dataBytes) throw new Error("ZIP export is missing learnbuddy-data.json.");
  const data = JSON.parse(dataBytes.toString("utf8")) as {
    export?: {
      payloadSha256?: string;
      offline?: { selfContained?: boolean; externalAssets?: number };
      slideEngine?: { renderer?: string; slideDocumentSchemaVersion?: string; slideDocumentId?: string };
    };
    lecture?: { slideDocument?: { schemaVersion?: string; slides?: unknown[] }; slides?: unknown[]; questions?: unknown[] };
    manifest?: unknown;
  };
  expect(data.manifest).toBeUndefined();
  expect(data.export?.payloadSha256).toBe(manifest.integrity?.payloadSha256);
  expect(data.export?.offline).toMatchObject({ selfContained: true, externalAssets: 0 });
  expect(data.export?.slideEngine).toMatchObject(manifest.slideEngine ?? {});
  expect(data.lecture?.slideDocument?.schemaVersion).toBe("learnordie.slide.v1");
  expect(data.lecture?.slideDocument?.slides?.length).toBeGreaterThan(0);
  expect(data.lecture?.slides?.length).toBeGreaterThan(0);
  expect(data.lecture?.questions?.length).toBeGreaterThan(0);

  const html = entries.get("index.html")?.toString("utf8") ?? "";
  expect(html).toContain('id="learnbuddy-data"');
  expect(html).toContain('data-slide-engine="learnordie-slide-standalone-v1"');
  expect(html).toContain('data-slide-document-version="learnordie.slide.v1"');
  expect(html).toContain("Self-contained: ja, externe Assets: 0");
  expect(html).toContain("data:audio/wav;base64,");
});

test("Magic-Link-Rate-Limit blockiert zu viele Anfragen", async ({ page }) => {
  const assertClean = attachBrowserDiagnostics(page);
  const email = "rate-limit@example.test";

  const oversized = await page.request.post("/api/auth/magic-link", {
    data: { email: `${"x".repeat(2500)}@example.test` }
  });
  expect(oversized.status()).toBe(413);

  for (let index = 0; index < 5; index += 1) {
    const response = await page.request.post("/api/auth/magic-link", {
      data: { email }
    });
    expect(response.status()).toBe(200);
  }

  const blocked = await page.request.post("/api/auth/magic-link", {
    data: { email }
  });
  expect(blocked.status()).toBe(429);
  expect(blocked.headers()["retry-after"]).toBeTruthy();
  const payload = await blocked.json() as { error?: string; retryAfterSeconds?: number };
  expect(payload.error).toBe("Zu viele Magic-Link-Anfragen. Bitte später erneut versuchen.");
  expect(payload.retryAfterSeconds).toBeGreaterThan(0);
  assertClean();
});

test("Retention-Cleanup anonymisiert alte Lernsignale und behält Kursinhalte", async ({ page }) => {
  const assertClean = attachBrowserDiagnostics(page);
  const seeded = await seedOldRetentionRecords();

  const dryRun = await runAdminCommand(["retention-cleanup", "--years", "5", "--lecture-token", "gleitlagerung-demo"]);
  expect(dryRun.ok).toBe(true);
  expect(dryRun.applied).toBe(false);
  expect(dryRun.policy?.schemaVersion).toBe("learnbuddy-retention-policy-v1");
  expect(dryRun.policy?.pseudonymousLearningSignals?.years).toBe(5);
  expect(dryRun.policy?.pseudonymousLearningSignals?.cleanupAction).toBe("anonymize");
  expect(dryRun.policy?.courseContent?.autoCleanup).toBe(false);
  expect(dryRun.policy?.standaloneArtifacts?.minimumYears).toBe(20);
  expect(dryRun.affected).toMatchObject({
    participant_sessions: 1,
    analytics_events: 1,
    answers: 1,
    student_chat_questions: 1,
    transcript_segments: 1
  });
  expect(dryRun.skippedContent).toMatchObject({ lecture_assets: 1 });

  const applied = await runAdminCommand([
    "retention-cleanup",
    "--years",
    "5",
    "--lecture-token",
    "gleitlagerung-demo",
    "--apply",
    "--confirm-retention-cleanup"
  ]);
  expect(applied.ok).toBe(true);
  expect(applied.applied).toBe(true);
  expect(applied.touchedTotal).toBe(5);
  expect(applied.affected).toMatchObject({
    participant_sessions: 1,
    analytics_events: 1,
    answers: 1,
    student_chat_questions: 1,
    transcript_segments: 1
  });
  expect(applied.skippedContent).toMatchObject({ lecture_assets: 1 });

  const afterReport = await runAdminCommand(["retention-report", "--years", "5", "--lecture-token", "gleitlagerung-demo"]);
  expect(afterReport.cleanupTotal).toBe(0);
  expect(afterReport.contentTotal).toBeGreaterThanOrEqual(1);
  expect(afterReport.policy?.courseContent?.retentionClass).toBe("owner-controlled-course-content");
  expect(afterReport.policy?.standaloneArtifacts?.retentionClass).toBe("long-term-standalone-archive");
  expect(afterReport.counts).toMatchObject({
    participant_sessions: 0,
    analytics_events: 0,
    answers: 0,
    student_chat_questions: 0,
    transcript_segments: 0
  });

  const sql = postgres(e2eDatabaseUrl, { max: 1, prepare: false });
  try {
    const [participant] = await sql<{
      pseudonym: string;
      anonymous_key: string;
    }[]>`
      select pseudonym, anonymous_key
      from participant_sessions
      where id = ${seeded.sessionId}
      limit 1
    `;
    const [answer] = await sql<{
      answer_session: string | null;
    }[]>`
      select participant_session_id as answer_session
      from answers
      where lecture_id = ${seeded.lectureId}
        and selected_key = 'B'
        and response_ms = 4200
        and created_at = ${seeded.oldAt}
      limit 1
    `;
    const [analytics] = await sql<{
      analytics_session: string | null;
      analytics_payload: { retained?: boolean; raw?: string };
    }[]>`
      select participant_session_id as analytics_session, event_payload as analytics_payload
      from analytics_events
      where lecture_id = ${seeded.lectureId}
        and event_type = 'quiz_answered'
        and occurred_at = ${seeded.oldAt}
      limit 1
    `;
    const [chat] = await sql<{
      chat_pseudonym: string;
      chat_anonymous_key: string | null;
      question_text: string;
    }[]>`
      select pseudonym as chat_pseudonym, anonymous_key as chat_anonymous_key, question_text
      from student_chat_questions
      where lecture_id = ${seeded.lectureId}
        and created_at = ${seeded.oldAt}
      limit 1
    `;
    const [transcript] = await sql<{
      transcript_text: string;
    }[]>`
      select text as transcript_text
      from transcript_segments
      where lecture_id = ${seeded.lectureId}
        and created_at = ${seeded.oldAt}
      limit 1
    `;
    const [asset] = await sql<{
      asset_storage_key: string;
    }[]>`
      select storage_key as asset_storage_key
      from lecture_assets
      where lecture_id = ${seeded.lectureId}
        and storage_key = ${`${seeded.anonymousKey}-asset`}
      limit 1
    `;

    expect(participant.pseudonym).toBe("Anonymisiert");
    expect(participant.anonymous_key).toBe(`retained:${seeded.sessionId}`);
    expect(answer.answer_session).toBeNull();
    expect(analytics.analytics_session).toBeNull();
    expect(analytics.analytics_payload.retained).toBe(true);
    expect(analytics.analytics_payload.raw).toBeUndefined();
    expect(chat.chat_pseudonym).toBe("Anonymisiert");
    expect(chat.chat_anonymous_key).toBeNull();
    expect(chat.question_text).toBe("[nach Aufbewahrungsfrist anonymisiert]");
    expect(transcript.transcript_text).toBe("[nach Aufbewahrungsfrist redigiert]");
    expect(asset.asset_storage_key).toBe(`${seeded.anonymousKey}-asset`);
  } finally {
    await sql.end();
  }

  await loginLecturer(page);
  const apiResult = await page.evaluate(async (lectureId) => {
    const response = await fetch(`/api/lectures/${lectureId}/retention`, {
      credentials: "same-origin"
    });
    return {
      status: response.status,
      body: await response.json() as {
        summary?: {
          counts?: Array<{ key: string; count: number }>;
          staleTotal?: number;
          cleanupTotal?: number;
          contentTotal?: number;
          policy?: {
            courseContent?: { retentionClass?: string };
            standaloneArtifacts?: { minimumYears?: number };
          };
        }
      }
    };
  }, seeded.lectureId);
  expect(apiResult.status).toBe(200);
  const summary = apiResult.body.summary ?? {};
  expect(summary.cleanupTotal).toBe(0);
  expect(summary.contentTotal).toBeGreaterThanOrEqual(1);
  expect(summary.policy?.courseContent?.retentionClass).toBe("owner-controlled-course-content");
  expect(summary.policy?.standaloneArtifacts?.minimumYears).toBe(20);
  const countsByKey = new Map((summary.counts ?? []).map((item) => [item.key, item.count]));
  expect(countsByKey.get("participant_sessions") ?? 0).toBe(0);
  expect(countsByKey.get("analytics_events") ?? 0).toBe(0);
  expect(countsByKey.get("answers") ?? 0).toBe(0);
  expect(countsByKey.get("student_chat_questions") ?? 0).toBe(0);
  expect(countsByKey.get("transcript_segments") ?? 0).toBe(0);
  expect(countsByKey.get("lecture_assets")).toBeGreaterThanOrEqual(1);
  assertClean();
});

test("Materialupload extrahiert PDF- und PPTX-Fachtext robust", async ({ page }) => {
  const assertClean = attachBrowserDiagnostics(page);
  const pdfName = "robuste-gleitlagerung.pdf";
  const scannedPdfName = "scan-gleitlagerung.pdf";
  const ocrPdfName = "scan-mit-ocr.pdf";
  const imageOnlyPdfName = "scan-ohne-text.pdf";
  const pptxName = "robuste-gleitlagerung.pptx";

  await loginLecturer(page);
  await page.getByLabel("Quellen für diese Folie").click();
  await expect(page.getByLabel("Quellen direkt an der Folie")).toBeVisible();
  const sourceFileInput = () => page
    .getByLabel("Quellen direkt an der Folie")
    .locator('input[type="file"][name="file"]');
  async function uploadSourceFile(name: string, mimeType: string, buffer: Buffer) {
    await sourceFileInput().setInputFiles({ name, mimeType, buffer });
    const responsePromise = page.waitForResponse((response) => (
      response.url().includes("/api/lectures/") &&
      response.url().endsWith("/materials") &&
      response.request().method() === "POST"
    ));
    await page.getByRole("button", { name: "Datei hinzufügen" }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(201);
    await expect(page.getByText(name)).toBeVisible();
    await expect(page.getByText("Quelle hinzugefügt.")).toBeVisible();
  }

  await uploadSourceFile(pdfName, "application/pdf", pdfUploadFixture());
  await uploadSourceFile(scannedPdfName, "application/pdf", scannedPdfUploadFixture());
  await uploadSourceFile(ocrPdfName, "application/pdf", ocrPdfUploadFixture());
  await uploadSourceFile(imageOnlyPdfName, "application/pdf", imageOnlyPdfUploadFixture());
  await uploadSourceFile(
    pptxName,
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    pptxUploadFixture()
  );

  const blockedUrlTrap = await startStorageReadTrap();
  const blockedLoopbackUrl = new URL(blockedUrlTrap.url);
  blockedLoopbackUrl.hostname = "lvh.me";
  const blockedLoopbackUrlText = blockedLoopbackUrl.toString();
  const sql = postgres(e2eDatabaseUrl, { max: 1, prepare: false });
  try {
    await page.getByRole("button", { name: "Link" }).click();
    await page.getByLabel("URL").fill(blockedLoopbackUrlText);
    const urlResponsePromise = page.waitForResponse((response) => (
      response.url().includes("/api/lectures/") &&
      response.url().endsWith("/materials") &&
      response.request().method() === "POST"
    ));
    await page.getByRole("button", { name: "Link hinzufügen" }).click();
    const urlResponse = await urlResponsePromise;
    expect(urlResponse.status()).toBe(201);
    await expect(page.getByText(blockedLoopbackUrlText)).toBeVisible();

    const processingResponse = page.waitForResponse((response) => (
      response.url().includes("/api/lectures/") &&
      response.url().includes("/process-materials") &&
      response.request().method() === "POST"
    ));
    await page.getByRole("button", { name: "Fragen aktualisieren" }).click();
    await processingResponse;
    await expect(page.getByText("Materialverarbeitung abgeschlossen.")).toBeVisible();
    await expect(page.getByLabel("Letzte Materialverarbeitung")).toContainText("Materialien");
    await expect(page.getByLabel("Letzte Materialverarbeitung")).toContainText("URL-Abruf blockiert");

    const chunks = await sql<{ content: string; source_ref: string }[]>`
      select ac.content, ac.source_ref
      from asset_chunks ac
      join lecture_assets la on la.id = ac.asset_id
      where la.original_name in (${pdfName}, ${scannedPdfName}, ${ocrPdfName}, ${pptxName})
      order by la.original_name, ac.source_ref
    `;
    const ocrReviews = await sql<{ count: number }[]>`
      select count(qri.id)::int as count
      from lecture_assets la
      left join question_review_items qri on qri.source_material_id = la.id
      where la.original_name = ${ocrPdfName}
    `;
    const imageOnlyChunks = await sql<{ count: number }[]>`
      select count(ac.id)::int as count
      from lecture_assets la
      left join asset_chunks ac on ac.asset_id = la.id
      where la.original_name = ${imageOnlyPdfName}
    `;
    const imageOnlyReviews = await sql<{ count: number }[]>`
      select count(qri.id)::int as count
      from lecture_assets la
      left join question_review_items qri on qri.source_material_id = la.id
      where la.original_name = ${imageOnlyPdfName}
    `;
    const blockedUrlChunks = await sql<{ count: number }[]>`
      select count(ac.id)::int as count
      from lecture_assets la
      left join asset_chunks ac on ac.asset_id = la.id
      where la.original_name = ${blockedLoopbackUrlText}
    `;
    const blockedUrlReviews = await sql<{ count: number }[]>`
      select count(qri.id)::int as count
      from lecture_assets la
      left join question_review_items qri on qri.source_material_id = la.id
      where la.original_name = ${blockedLoopbackUrlText}
    `;
    const latestRuns = await sql<{ steps_json: Array<{ label?: string; detail?: string; status?: string }> }[]>`
      select steps_json
      from material_processing_runs
      order by started_at desc
      limit 1
    `;
    const combined = chunks.map((chunk) => chunk.content).join("\n");
    expect(combined).toContain("Stribeck-Kurve aus PDF");
    expect(combined).toContain("Mischreibung");
    expect(combined).toContain("Sommerfeldzahl");
    expect(combined).toContain("Schnittbild Gleitlager mit Oelkeil und Schmierfilm");
    expect(combined).toContain("Bildbasierte PDF-Inhalte erkannt: 1 eingebettete Bilder.");
    expect(combined).toContain("OCR erkannte Gleitlagerfolie mit Oelkeil, Schmierfilm, Mischreibung und Sommerfeldzahl.");
    expect(combined).toContain("OCR-Layout:");
    expect(combined).toContain("Hauptdiagramm");
    expect(combined).toContain("Stribeck-Layoutanker");
    expect(combined).toContain("Hydrodynamische Gleitlagerung aus PPTX");
    expect(combined).toContain("Diagramm: Reibungszahl und Sommerfeldzahl");
    expect(combined).toContain("Stribeck-Bild: Reibungszahl ueber Sommerfeldzahl");
    expect(combined).toContain("Visuelle Struktur:");
    expect(combined).toContain("Bildposition: Folie 1");
    expect(combined).toContain("Stribeck-Bild: Reibungszahl ueber Sommerfeldzahl · mittig rechts");
    expect(combined).toContain("x=7315200 y=1828800 w=3048000 h=2133600 EMU");
    expect(combined).toContain("Dozentennotiz: Anlaufphase mit Mischreibung hervorheben.");
    expect(imageOnlyChunks[0].count).toBe(0);
    expect(imageOnlyReviews[0].count).toBe(0);
    expect(ocrReviews[0].count).toBe(1);
    expect(blockedUrlChunks[0].count).toBe(0);
    expect(blockedUrlReviews[0].count).toBe(0);
    expect(blockedUrlTrap.requestCount()).toBe(0);
    expect(latestRuns[0].steps_json.some((step) => (
      step.label === `Review-Vorschlag übersprungen: ${imageOnlyPdfName}` &&
      step.status === "skipped" &&
      step.detail?.includes("Keine verwertbaren Fachtext-Chunks")
    ))).toBe(true);
  } finally {
    await sql.end();
    await blockedUrlTrap.close();
  }

  assertClean();
});

test("Materialverarbeitung lehnt doppelte KI-Fragevarianten ab", async ({ page }) => {
  test.setTimeout(90_000);
  const aiMock = await startDuplicateQuestionGeneratorMock();
  const app = await startIsolatedNextServer({
    LEARNBUDDY_DEPLOYMENT_ENV: "local",
    LEARNBUDDY_QUESTION_GENERATOR: "ai",
    LEARNBUDDY_AI_PROVIDER: "openai-compatible",
    LEARNBUDDY_AI_BASE_URL: aiMock.url,
    LEARNBUDDY_AI_API_KEY: "duplicate-question-generator-secret",
    LEARNBUDDY_AI_MODEL: "duplicate-question-generator"
  });
  const issuedAt = new Date().toISOString();
  const sql = postgres(e2eDatabaseUrl, { max: 1, prepare: false });

  try {
    await page.context().addCookies([{
      name: lecturerSessionCookie,
      value: signTestPayload({
        email: "e2e@example.test",
        issuedAt,
        expiresAt: Date.now() + 60 * 60 * 1000
      }),
      url: app.url,
      httpOnly: true,
      sameSite: "Lax",
      expires: Math.floor(Date.now() / 1000) + 3600
    }]);

    await page.goto(`${app.url}/lecturer`);
    await expect(page.getByRole("textbox", { name: "Folientitel" })).toContainText("Hydrodynamische Gleitlagerung");
    const csrfToken = await lecturerCsrfToken(page);
    const lecturesResponse = await page.request.get(`${app.url}/api/lectures`);
    expect(lecturesResponse.ok()).toBe(true);
    const lecturesPayload = await lecturesResponse.json() as { lectures: Array<{ id: string; title: string }> };
    const lecture = lecturesPayload.lectures.find((candidate) => candidate.title.includes("Gleitlagerung")) ?? lecturesPayload.lectures[0];
    expect(lecture?.id).toBeTruthy();

    const materialName = `duplicate-question-guard-${Date.now()}`;
    const materialResponse = await page.request.post(`${app.url}/api/lectures/${lecture.id}/materials`, {
      headers: { "x-learnbuddy-csrf": csrfToken },
      multipart: {
        notes: `${materialName}: Hydrodynamische Gleitlagerung, Mischreibung und Stribeck-Kurve.`
      }
    });
    expect(materialResponse.status()).toBe(201);

    const processingResponse = await page.request.post(`${app.url}/api/lectures/${lecture.id}/process-materials`, {
      headers: { "x-learnbuddy-csrf": csrfToken }
    });
    expect(processingResponse.status()).toBe(500);
    const processingPayload = await processingResponse.json() as { error?: string };
    expect(processingPayload.error).toBe("Fragegenerator hat ungültige Fragen geliefert.");

    const runs = await sql<{ message: string | null; status: string }[]>`
      select message, status
      from material_processing_runs
      order by started_at desc
      limit 1
    `;
    expect(runs[0].status).toBe("failed");
    expect(runs[0].message).toContain("duplicate question texts");
  } finally {
    await sql.end();
    await app.close();
    await aiMock.close();
  }
});

test("Student Live: Teilnahme ohne Account, Sofortfeedback und Leaderboard", async ({ page }) => {
  const assertClean = attachBrowserDiagnostics(page);
  const chatQuestionUrl = "/api/lecture/gleitlagerung-demo/chat-questions";

  await page.goto("/l/gleitlagerung-demo");
  await page.getByPlaceholder("z. B. LagerProfi42").fill("E2E Lager");
  await page.getByRole("button", { name: "Teilnehmen" }).click();
  await expect(page.locator('[data-slide-engine="v1"]')).toBeVisible();
  await expect(page.getByLabel("Quizfrage")).toBeVisible();

  await page.getByRole("button", { name: "Chatfrage stellen" }).click();
  await page.getByPlaceholder("Fachliche Frage zur Vorlesung stellen ...").fill("Wie verändert Viskosität die Stribeck-Kurve?");
  const chatResponsePromise = page.waitForResponse((response) => (
    response.url().includes(chatQuestionUrl) &&
    response.request().method() === "POST"
  ));
  await page.getByRole("button", { name: "Senden" }).click();
  const chatResponse = await chatResponsePromise;
  const chatPayload = await chatResponse.json() as {
    accepted?: boolean;
    chatQuestion?: {
      moderationProvider?: string;
      moderationModel?: string;
      moderationConfidence?: number;
      moderationSignals?: string[];
    };
  };
  expect(chatPayload.accepted).toBe(true);
  expect(chatPayload.chatQuestion?.moderationProvider).toBe("openai-compatible");
  expect(chatPayload.chatQuestion?.moderationModel).toBe("mock-e2e-chat");
  expect(chatPayload.chatQuestion?.moderationConfidence).toBeGreaterThanOrEqual(90);
  expect(chatPayload.chatQuestion?.moderationSignals).toContain("Stribeck");
  await expect(page.getByText("Frage wurde an den Referenten weitergeleitet.")).toBeVisible();
  await page.getByRole("button", { name: "Schließen" }).click();

  const missingKeyResponse = await page.request.post(chatQuestionUrl, {
    data: {
      text: "Wie verändert Viskosität die Stribeck-Kurve?",
      pseudonym: "Ohne Key"
    }
  });
  expect(missingKeyResponse.status()).toBe(400);

  const oversizedResponse = await page.request.post(chatQuestionUrl, {
    data: {
      text: "Stribeck ".repeat(700),
      pseudonym: "Zu Groß",
      anonymousKey: "oversized-chat-key"
    }
  });
  expect(oversizedResponse.status()).toBe(413);

  const rateLimitKey = `chat-rate-${Date.now().toString(36)}`;
  for (let index = 0; index < 3; index += 1) {
    const response = await page.request.post(chatQuestionUrl, {
      data: {
        text: `Wie verändert Viskosität die Stribeck-Kurve bei Mischreibung ${index}?`,
        pseudonym: "Rate Limit",
        anonymousKey: rateLimitKey
      }
    });
    expect(response.ok()).toBe(true);
  }
  const blockedResponse = await page.request.post(chatQuestionUrl, {
    data: {
      text: "Wie verändert Viskosität die Stribeck-Kurve beim nächsten Versuch?",
      pseudonym: "Rate Limit",
      anonymousKey: rateLimitKey
    }
  });
  expect(blockedResponse.status()).toBe(429);
  expect(blockedResponse.headers()["retry-after"]).toBe("900");

  await page.getByRole("button", { name: /Es treten gleichzeitig Schmierfilmanteile/ }).click();
  await expect(page.getByText("Antwort gespeichert: richtig.")).toBeVisible();
  await expect(page.getByText("+3 Punkte")).toBeVisible();

  await page.getByRole("button", { name: "Leaderboard anzeigen" }).click();
  await expect(page.getByRole("complementary", { name: "Leaderboard" })).toBeVisible();
  await expect(page.getByText(/1 · E2E Lager/)).toBeVisible();
  await expect(page.locator(".leader-row.self").filter({ hasText: "E2E Lager" })).toContainText("3");
  assertClean();
});

test("Student Live: Leaderboard bleibt bei 30 Studierenden konsistent", async ({ page }) => {
  const assertClean = attachBrowserDiagnostics(page);
  const runId = Date.now().toString(36);
  const participants = await seedLiveLeaderboardLoad(page, runId);
  const topParticipant = participants[0];

  const apiResponse = await page.request.get(`/api/lecture/gleitlagerung-demo/leaderboard?anonymousKey=${encodeURIComponent(topParticipant.anonymousKey)}`);
  expect(apiResponse.ok()).toBe(true);
  const leaderboardPayload = await apiResponse.json() as {
    enabled?: boolean;
    entries?: Array<{
      rank: number;
      name: string;
      points: number;
      correct: number;
      answers: number;
      self: boolean;
    }>;
  };
  expect(leaderboardPayload.enabled).toBe(true);
  expect(leaderboardPayload.entries).toHaveLength(10);
  expect(leaderboardPayload.entries?.[0]).toMatchObject({
    rank: 1,
    name: "Load 01",
    points: 12,
    correct: 3,
    answers: 3,
    self: true
  });
  const lowerParticipant = participants[29];
  const lowerResponse = await page.request.get(`/api/lecture/gleitlagerung-demo/leaderboard?anonymousKey=${encodeURIComponent(lowerParticipant.anonymousKey)}`);
  expect(lowerResponse.ok()).toBe(true);
  const lowerPayload = await lowerResponse.json() as typeof leaderboardPayload;
  const lowerSelf = lowerPayload.entries?.find((entry) => entry.self);
  expect(lowerPayload.entries?.slice(0, 10)).toHaveLength(10);
  expect(lowerSelf).toMatchObject({
    name: lowerParticipant.pseudonym,
    points: 2,
    correct: 1,
    answers: 1,
    self: true
  });
  expect(lowerSelf?.rank).toBeGreaterThan(10);

  await page.goto("/l/gleitlagerung-demo");
  await page.getByPlaceholder("z. B. LagerProfi42").fill(`Viewer ${runId}`);
  await page.getByRole("button", { name: "Teilnehmen" }).click();
  await page.getByRole("button", { name: "Leaderboard anzeigen" }).click();
  await expect(page.getByRole("complementary", { name: "Leaderboard" })).toBeVisible();
  await expect(page.locator(".leader-row")).toHaveCount(10);
  await expect(page.locator(".leader-row").first()).toContainText("1 · Load 01");
  await expect(page.locator(".leader-row").first()).toContainText("12");
  assertClean();
});

test("Live-Load-Smoke prueft 30 pseudonyme Teilnahmen ueber oeffentliche APIs", async () => {
  const result = await runLiveLoadSmokeAllowFailure([
    "--url", e2eBaseOrigin,
    "--lecture-token", "gleitlagerung-demo",
    "--participants", "30",
    "--concurrency", "10",
    "--timeout-ms", "60000"
  ]);

  expect(result.ok).toBe(true);
  const passed = new Set(
    (result.checks ?? [])
      .filter((check) => check.status === "pass")
      .map((check) => check.id)
  );
  expect(passed).toEqual(new Set([
    "live_load_target",
    "health",
    "student_live_page",
    "student_join_load",
    "answer_load",
    "answer_latency",
    "leaderboard_anchor_load",
    "leaderboard_consistency"
  ]));
  const answerLoad = (result.checks ?? []).find((check) => check.id === "answer_load");
  expect(answerLoad?.details?.participants).toBe(29);
  expect(answerLoad?.details?.totalAnswers).toBe(116);
  const leaderboard = (result.checks ?? []).find((check) => check.id === "leaderboard_consistency");
  expect(leaderboard?.details?.self).toMatchObject({
    rank: 1,
    points: 30,
    correct: 12,
    answers: 12
  });
});

test("Learn-Modus: Fragedichte, KI-Chat-Link, Leaderboard und Mobile-Fit", async ({ page }) => {
  const assertClean = attachBrowserDiagnostics(page);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/learn/gleitlagerung-demo");
  await expect(page.locator('[data-slide-engine="v1"]')).toBeVisible();

  const hotspots = page.getByLabel("Fragen-Hotspots").locator("button");
  await expect(hotspots).toHaveCount(4);
  await setRangeValue(page, ".learn-bar input", "1");
  await expect(hotspots).toHaveCount(1);
  await setRangeValue(page, ".learn-bar input", "7");
  await expect(hotspots).toHaveCount(7);

  await page.getByLabel("Frage Niveau 1.0 anzeigen").first().click();
  await expect(page.getByLabel("Quizfrage")).toBeVisible();
  await expect(page.getByText("Eine schwer belastete Welle läuft häufig langsam an.")).toBeVisible();
  await page.getByRole("button", { name: "KI fragen" }).click();
  await expect(page.getByLabel("KI Chat")).toBeVisible();
  await expect(page.getByRole("heading", { name: "KI-Assistent" })).toBeVisible();
  await page.getByRole("button", { name: "Senden" }).click();
  await expect(page.getByText("Mock-Erklärung")).toBeVisible();
  await expect(page.getByText(/Tokens heute verfügbar/)).toBeVisible();
  const aiChat = page.getByLabel("KI Chat");
  await expect(aiChat).toHaveAttribute("data-ai-answer-state", "answered");
  await expect(aiChat).toHaveAttribute("data-ai-stream-source", "provider");
  await expect(aiChat).toHaveAttribute("data-ai-provider", "openai-compatible");
  const oversizedAiResponse = await page.request.post("/api/ai/chat", {
    data: {
      lectureToken: "gleitlagerung-demo",
      question: "Stribeck ".repeat(1100),
      message: "Bitte erklären.",
      anonymousKey: `ai-oversize-${Date.now().toString(36)}`,
      pseudonym: "AI Guard",
      stream: true
    }
  });
  expect(oversizedAiResponse.status()).toBe(413);

  const sql = postgres(e2eDatabaseUrl, { max: 1, prepare: false });
  try {
    const [event] = await sql<{ payload: { streaming?: boolean; streamSource?: string; provider?: string; tokens?: { total?: number } } }[]>`
      select event_payload as payload
      from analytics_events
      where event_type = 'ai_chat_answered'
      order by occurred_at desc
      limit 1
    `;
    expect(event.payload.streaming).toBe(true);
    expect(event.payload.streamSource).toBe("provider");
    expect(event.payload.provider).toBe("openai-compatible");
    expect(event.payload.tokens?.total).toBe(34);
  } finally {
    await sql.end();
  }

  const liveAiProviderSmoke = await runLiveSmokeAllowFailure([
    "--url", e2eBaseOrigin,
    "--lecture-token", "gleitlagerung-demo",
    "--include-ai",
    "--require-ai-provider",
    "--timeout-ms", "45000"
  ]);
  expect(liveAiProviderSmoke.ok).toBe(true);
  const learnSmokeCheck = liveAiProviderSmoke.checks?.find((check) => check.id === "learn_browser");
  expect(learnSmokeCheck?.status).toBe("pass");
  expect(learnSmokeCheck?.details?.aiStreamSource).toBe("provider");
  expect(learnSmokeCheck?.details?.aiProvider).toBe("openai-compatible");
  await page.getByLabel("Chat schließen").click();

  await page.getByRole("button", { name: "Leaderboard anzeigen" }).click();
  await expect(page.getByRole("complementary", { name: "Leaderboard" })).toBeVisible();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  assertClean();
});

test("Motion-System folgt der learnordie.app-Spec in Learn- und Studio-Kernflows", async ({ page }) => {
  const assertClean = attachBrowserDiagnostics(page);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Vorlesungscode rein, Lernrunde starten" })).toBeVisible();
  await expect(page.getByText("LERNEN IM NORDEN")).toBeVisible();
  await expect(page.getByRole("link", { name: "Dozentenlogin" })).toHaveAttribute("href", "/lecturer");
  await expect(page.getByText("Hydrodynamische Gleitlagerung")).toHaveCount(0);
  await page.goto("/l/gleitlagerung-demo");
  await expect(page).toHaveURL(/\/l\/gleitlagerung-demo$/);
  await page.getByPlaceholder("z. B. LagerProfi42").fill("Motion Gate");
  await page.getByRole("button", { name: "Teilnehmen" }).click();
  await expect(page.locator(".student-gate-screen")).toHaveAttribute("data-joining", "true");
  const studentGateMotion = await page.evaluate(() => {
    const cover = document.querySelector<HTMLElement>(".student-gate-cover");
    const card = document.querySelector<HTMLElement>(".student-gate-card");
    if (!cover) throw new Error("Student gate cover missing.");
    if (!card) throw new Error("Student gate card missing.");
    const coverBox = cover.getBoundingClientRect();
    const coverOriginParts = getComputedStyle(cover).transformOrigin.split(" ");
    const coverOriginY = Number.parseFloat(coverOriginParts[1] ?? "0");
    return {
      coverAnimation: getComputedStyle(cover).animationName,
      coverOriginYRatio: coverOriginY / coverBox.height,
      cardState: card.dataset.joining,
      coverGrid: getComputedStyle(cover).backgroundImage
    };
  });
  expect(studentGateMotion.coverAnimation).toContain("lb-student-gate-cover-in");
  expect(studentGateMotion.coverOriginYRatio).toBeGreaterThan(0.95);
  expect(studentGateMotion.cardState).toBe("true");
  expect(studentGateMotion.coverGrid).toContain("linear-gradient");
  await expect(page.locator('[data-slide-engine="v1"]')).toBeVisible();
  await expect(page.getByLabel("Quizfrage")).toBeVisible();

  await page.goto("/learn/gleitlagerung-demo");
  await expect(page).toHaveURL(/\/learn\/gleitlagerung-demo$/);
  await expect(page.locator('[data-slide-engine="v1"]')).toBeVisible();

  await page.getByLabel("Frage Niveau 3.0 anzeigen").first().click();
  await expect(page.getByLabel("Quizfrage")).toBeVisible();

  const learnMotion = await page.evaluate(() => {
    const toMs = (value: string) => {
      const first = value.split(",")[0]?.trim() ?? "0s";
      if (first.endsWith("ms")) return Number.parseFloat(first);
      if (first.endsWith("s")) return Number.parseFloat(first) * 1000;
      return Number.parseFloat(first);
    };
    const root = getComputedStyle(document.documentElement);
    const slideScreen = document.querySelector<HTMLElement>(".slide-screen");
    const drawer = document.querySelector<HTMLElement>(".question-drawer");
    const originTrace = document.querySelector<HTMLElement>(".question-origin-trace");
    const answers = Array.from(document.querySelectorAll<HTMLElement>(".question-drawer .answer")).slice(0, 4);
    const cssText = Array.from(document.styleSheets)
      .flatMap((sheet) => {
        try {
          return Array.from(sheet.cssRules).map((rule) => rule.cssText);
        } catch {
          return [];
        }
      })
      .join("\n");
    if (!drawer) throw new Error("Question drawer missing.");
    if (!slideScreen) throw new Error("Slide screen missing.");
    const drawerOriginRatio = Number.parseFloat(getComputedStyle(drawer, "::before").left) / drawer.clientWidth;
    return {
      panelDurationMs: toMs(root.getPropertyValue("--lb-dur-panel")),
      sheetRadius: root.getPropertyValue("--lb-radius-sheet").trim(),
      drawerOrigin: drawer.dataset.origin,
      drawerAnimation: getComputedStyle(drawer).animationName,
      drawerRadius: getComputedStyle(drawer).borderTopLeftRadius,
      drawerOriginRatio,
      drawerHasTechnicalGrid: getComputedStyle(drawer).backgroundImage.includes("linear-gradient"),
      originTraceSocketAnimation: originTrace ? getComputedStyle(originTrace, "::before").animationName : "",
      slideAxisAnimation: getComputedStyle(slideScreen, "::after").animationName,
      answerDelays: answers.map((answer) => toMs(getComputedStyle(answer).animationDelay)),
      hotspotHasOvershoot: cssText.includes("scale(1.05)")
    };
  });
  expect(learnMotion.panelDurationMs).toBe(420);
  expect(learnMotion.sheetRadius).toBe("18px");
  expect(learnMotion.drawerOrigin).toBe("hotspot");
  expect(learnMotion.drawerAnimation).toContain("lb-drawer-rise");
  expect(learnMotion.drawerRadius).toBe("18px");
  expect(learnMotion.drawerOriginRatio).toBeGreaterThan(0.7);
  expect(learnMotion.drawerHasTechnicalGrid).toBe(true);
  expect(learnMotion.originTraceSocketAnimation).toContain("lb-origin-socket-in");
  expect(learnMotion.slideAxisAnimation).toContain("lb-stage-axis-in");
  expect(learnMotion.answerDelays).toHaveLength(4);
  expect(learnMotion.answerDelays[1]).toBeGreaterThan(learnMotion.answerDelays[0]);
  expect(learnMotion.answerDelays[3]).toBeGreaterThan(learnMotion.answerDelays[2]);
  expect(learnMotion.hotspotHasOvershoot).toBe(false);

  await page.getByRole("button", { name: "KI fragen" }).click();
  await expect(page.getByLabel("KI Chat")).toBeVisible();
  const chatMotion = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>(".overlay-panel.tall");
    if (!panel) throw new Error("KI panel missing.");
    return {
      origin: panel.dataset.panelOrigin,
      animationName: getComputedStyle(panel).animationName,
      radius: getComputedStyle(panel).borderTopLeftRadius,
      railBackground: getComputedStyle(panel, "::after").backgroundImage
    };
  });
  expect(chatMotion.origin).toBe("chat");
  expect(chatMotion.animationName).toContain("lb-inspector-right-in");
  expect(chatMotion.radius).toBe("18px");
  expect(chatMotion.railBackground).toContain("linear-gradient");

  await loginLecturer(page);
  const studioStageMotion = await page.evaluate(() => {
    const stage = document.querySelector<HTMLElement>(".studio-slide-stage");
    if (!stage) throw new Error("Studio stage missing.");
    return {
      axisAnimation: getComputedStyle(stage, "::after").animationName,
      hasTechnicalGrid: getComputedStyle(stage).backgroundImage.includes("linear-gradient")
    };
  });
  expect(studioStageMotion.axisAnimation).toContain("lb-stage-axis-in");
  expect(studioStageMotion.hasTechnicalGrid).toBe(true);

  const filmstripButtons = page.getByLabel("Folie auswählen").getByRole("button");
  await expect(filmstripButtons.nth(1)).toBeVisible();
  await filmstripButtons.nth(1).click();
  await expect(page.locator(".studio-slide-shared-ghost")).toBeAttached();
  const studioSharedSlideMotion = await page.evaluate(() => {
    const ghost = document.querySelector<HTMLElement>(".studio-slide-shared-ghost");
    const stage = document.querySelector<HTMLElement>(".dashboard-slide-preview[data-slide-id]");
    const active = document.querySelector<HTMLButtonElement>(".studio-filmstrip-list button[aria-current='true']");
    if (!ghost) throw new Error("Studio shared slide ghost missing.");
    if (!stage) throw new Error("Studio stage slide missing.");
    if (!active) throw new Error("Active studio slide button missing.");
    const timing = ghost.getAnimations()[0]?.effect?.getTiming();
    return {
      sharedElement: ghost.dataset.sharedElement,
      hasSharedClass: ghost.classList.contains("lb-enter-shared"),
      duration: timing?.duration,
      activeSlideId: active.dataset.slideId,
      stageSlideId: stage.dataset.slideId,
      ghostRadius: getComputedStyle(ghost).borderTopLeftRadius,
      ghostGrid: getComputedStyle(ghost).backgroundImage.includes("linear-gradient")
    };
  });
  expect(studioSharedSlideMotion.sharedElement).toBe("studio-slide");
  expect(studioSharedSlideMotion.hasSharedClass).toBe(true);
  expect(studioSharedSlideMotion.duration).toBe(620);
  expect(studioSharedSlideMotion.activeSlideId).toBe(studioSharedSlideMotion.stageSlideId);
  expect(studioSharedSlideMotion.ghostRadius).toBe("18px");
  expect(studioSharedSlideMotion.ghostGrid).toBe(true);
  await expect(page.locator(".studio-slide-shared-ghost")).toHaveCount(0, { timeout: 1500 });

  await page.getByLabel("Folienwerkzeuge öffnen").click();
  await expect(page.getByLabel("Folienwerkzeuge", { exact: true })).toBeVisible();
  await page.waitForTimeout(500);
  const toolMotion = await page.evaluate(() => {
    const popover = document.querySelector<HTMLElement>(".studio-tool-popover");
    const choices = Array.from(document.querySelectorAll<HTMLElement>(".studio-tool-choice")).slice(0, 5);
    const toMs = (value: string) => {
      const first = value.split(",")[0]?.trim() ?? "0s";
      if (first.endsWith("ms")) return Number.parseFloat(first);
      if (first.endsWith("s")) return Number.parseFloat(first) * 1000;
      return Number.parseFloat(first);
    };
    if (!popover) throw new Error("Tool popover missing.");
    const originMarker = getComputedStyle(popover, "::before");
    return {
      popoverAnimation: getComputedStyle(popover).animationName,
      popoverOriginMarkerContent: originMarker.content,
      popoverOriginMarkerBottom: toMs(originMarker.bottom),
      popoverOriginMarkerWidth: originMarker.width,
      choiceDelays: choices.map((choice) => toMs(getComputedStyle(choice).animationDelay))
    };
  });
  expect(toolMotion.popoverAnimation).toContain("lb-popover-from-control");
  expect(toolMotion.popoverOriginMarkerContent).toBe("\"\"");
  expect(toolMotion.popoverOriginMarkerBottom).toBeLessThanOrEqual(-5);
  expect(toolMotion.popoverOriginMarkerBottom).toBeGreaterThanOrEqual(-12);
  expect(toolMotion.popoverOriginMarkerWidth).toBe("58px");
  expect(toolMotion.choiceDelays[4]).toBeGreaterThan(toolMotion.choiceDelays[0]);

  await page.getByRole("button", { name: "Fragen auf dieser Folie" }).click();
  await expect(page.getByLabel("Fragen direkt auf der Folie")).toBeVisible();
  const studioSheetMotion = await page.evaluate(() => {
    const sheet = document.querySelector<HTMLElement>(".studio-slide-question-overlay");
    if (!sheet) throw new Error("Studio question sheet missing.");
    return {
      isContextDrawer: sheet.classList.contains("studio-context-drawer"),
      animationName: getComputedStyle(sheet).animationName,
      radius: getComputedStyle(sheet).borderTopLeftRadius
    };
  });
  expect(studioSheetMotion.isContextDrawer).toBe(true);
  expect(studioSheetMotion.animationName).toContain("lb-tool-sheet-in");
  expect(studioSheetMotion.radius).toBe("18px");

  await page.goto("/lecturer/live/gleitlagerung-demo");
  await expect(page.locator('[data-slide-engine="v1"]')).toBeVisible();
  await expect(page.getByLabel("Transkriptstatus")).toBeVisible();
  await expect(page.getByRole("button", { name: "STT starten" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Passage transkribieren" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Auto-Segmente" })).toBeDisabled();
  await page.waitForTimeout(600);
  const lecturerLiveSttMotion = await page.evaluate(() => {
    const panel = document.querySelector<HTMLElement>(".transcript-panel");
    const autoButton = Array.from(document.querySelectorAll<HTMLButtonElement>(".transcript-actions button"))
      .find((button) => button.textContent?.includes("Auto-Segmente"));
    if (!panel) throw new Error("Transkriptpanel fehlt.");
    if (!autoButton) throw new Error("Auto-Segment-Button fehlt.");
    const panelBox = panel.getBoundingClientRect();
    return {
      panelOrigin: panel.dataset.panelOrigin,
      animationName: getComputedStyle(panel).animationName,
      autoDisabled: autoButton.disabled,
      actionColumns: getComputedStyle(document.querySelector<HTMLElement>(".transcript-actions")!).gridTemplateColumns.split(" ").filter(Boolean).length,
      overflowX: document.documentElement.scrollWidth - window.innerWidth,
      panelWidth: Math.round(panelBox.width),
      panelRight: Math.round(window.innerWidth - panelBox.right)
    };
  });
  expect(lecturerLiveSttMotion.panelOrigin).toBe("transcript");
  expect(lecturerLiveSttMotion.animationName).toContain("lb-inspector-right-in");
  expect(lecturerLiveSttMotion.autoDisabled).toBe(true);
  expect(lecturerLiveSttMotion.actionColumns).toBe(2);
  expect(lecturerLiveSttMotion.overflowX).toBeLessThanOrEqual(1);
  expect(lecturerLiveSttMotion.panelWidth).toBeLessThanOrEqual(420);
  expect(lecturerLiveSttMotion.panelRight).toBeGreaterThanOrEqual(-4);

  assertClean();
});
