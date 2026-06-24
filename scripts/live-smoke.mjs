#!/usr/bin/env node

const DEFAULT_TIMEOUT_MS = 45_000;
const DEFAULT_LECTURE_TOKEN = "gleitlagerung-demo";

const HELP_TEXT = `
Usage: npm run smoke:live -- [options]

Runs a public browser smoke against Health, Student Live, Learn and optional lecturer/AI paths.

Options:
  --url <app-url>                   Public app URL. Required unless LEARNBUDDY_LIVE_SMOKE_URL is set.
  --lecture-token <token>           Lecture token. Defaults to gleitlagerung-demo.
  --include-ai                      Exercise the Learn AI chat path.
  --require-ai-provider             Fail if the Learn AI chat does not use a provider-backed stream.
  --include-assistant               Exercise the lecturer assistant path.
  --require-assistant-provider      Fail if the assistant does not use a provider-backed answer.
  --auth                            Include lecturer auth when a magic link is available.
  --require-auth                    Require a valid absolute HTTPS magic link.
  --email <email>                   Lecturer email for auth smoke.
  --magic-link <url>                Real magic link for auth smoke.
  --headed                          Run Chromium headed.
  --timeout-ms <ms>                 Browser timeout. Defaults to 45000.

Example:
  npm run smoke:live -- --url https://<preview-url> --lecture-token gleitlagerung-demo --include-ai
`;

function parseArgs() {
  const result = new Map();
  for (let index = 2; index < process.argv.length; index += 1) {
    const item = process.argv[index];
    if (!item.startsWith("--")) continue;
    const [rawKey, inlineValue] = item.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      result.set(rawKey, inlineValue);
      continue;
    }
    const next = process.argv[index + 1];
    if (!next || next.startsWith("--")) {
      result.set(rawKey, "1");
      continue;
    }
    result.set(rawKey, next);
    index += 1;
  }
  return result;
}

function helpRequested() {
  return process.argv.slice(2).some((item) => item === "-h" || item === "--help" || item.startsWith("--help="));
}

if (helpRequested()) {
  console.log(HELP_TEXT.trim());
  process.exit(0);
}

const args = parseArgs();
const checks = [];

function envValue(name) {
  return (process.env[name] ?? "").trim();
}

function secretValues() {
  return Object.entries(process.env)
    .filter(([key, value]) => value && /(KEY|TOKEN|SECRET|PASSWORD|AUTH|LINK)/i.test(key))
    .map(([, value]) => String(value))
    .filter((value) => value.length >= 8);
}

function sanitize(value) {
  let text = value instanceof Error ? value.message : String(value);
  for (const secret of secretValues()) {
    text = text.split(secret).join("[secret]");
  }
  return text.replace(/token=[A-Za-z0-9._~+/=-]+/g, "token=[secret]");
}

function record(id, status, message, details = {}) {
  checks.push({
    id,
    status,
    message: sanitize(message),
    details
  });
}

function pass(id, message, details) {
  record(id, "pass", message, details);
}

function warn(id, message, details) {
  record(id, "warn", message, details);
}

function skip(id, message, details) {
  record(id, "skip", message, details);
}

function fail(id, message, details) {
  record(id, "fail", message, details);
}

function configuredTimeoutMs() {
  const value = Number(args.get("timeout-ms") || envValue("LEARNBUDDY_LIVE_SMOKE_TIMEOUT_MS"));
  return Number.isFinite(value) && value > 0 ? Math.min(120_000, Math.round(value)) : DEFAULT_TIMEOUT_MS;
}

function normalizeBaseUrl(value) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("--url or LEARNBUDDY_LIVE_SMOKE_URL is required.");
  const parsed = new URL(trimmed);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Live smoke URL must be HTTP(S).");
  }
  return parsed.toString().replace(/\/+$/, "");
}

function normalizeHostname(hostname) {
  return hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
}

function ipv4Octets(address) {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return parts;
}

function isPrivateIpv4(address) {
  const octets = ipv4Octets(address);
  if (!octets) return false;
  const [first, second, third] = octets;
  return first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 0 || second === 168)) ||
    (first === 198 && (second === 18 || second === 19 || (second === 51 && third === 100))) ||
    (first === 203 && second === 0 && third === 113);
}

function isPrivateIpv6(address) {
  const lower = normalizeHostname(address);
  const mappedIpv4 = lower.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mappedIpv4) return isPrivateIpv4(mappedIpv4[1]);
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("2001:db8:") || lower === "2001:db8::") return true;

  const firstSegment = Number.parseInt(lower.split(":")[0] || "0", 16);
  if (!Number.isFinite(firstSegment)) return false;
  return (firstSegment >= 0xfc00 && firstSegment <= 0xfdff) ||
    (firstSegment >= 0xfe80 && firstSegment <= 0xfebf) ||
    (firstSegment >= 0xff00 && firstSegment <= 0xffff);
}

function isLocalOrPrivateHost(hostname) {
  const lower = normalizeHostname(hostname);
  if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local")) return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(lower)) return isPrivateIpv4(lower);
  if (lower.includes(":")) return isPrivateIpv6(lower);
  return false;
}

function publicLiveTarget() {
  try {
    const parsed = new URL(baseUrl);
    return !isLocalOrPrivateHost(parsed.hostname);
  } catch {
    return false;
  }
}

function liveTargetProblem() {
  const parsed = new URL(baseUrl);
  if (parsed.protocol === "https:" || isLocalOrPrivateHost(parsed.hostname)) {
    return null;
  }
  return {
    message: "Public live smoke requires a HTTPS app URL.",
    details: {
      origin: parsed.origin,
      protocol: parsed.protocol
    }
  };
}

function appUrl(path) {
  return `${baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
}

function magicLinkTargetProblem(link, options = {}) {
  try {
    const app = new URL(baseUrl);
    if (options.requireAbsoluteHttps && !/^https:\/\//i.test(link.trim())) {
      return {
        message: "Public authenticated live smoke requires an absolute HTTPS magic link.",
        details: {
          requiredScheme: "https"
        }
      };
    }
    const parsed = new URL(link, baseUrl);
    if (parsed.origin !== app.origin) {
      return {
        message: "Magic link must belong to the checked app origin.",
        details: {
          expectedOrigin: app.origin,
          actualOrigin: parsed.origin
        }
      };
    }
    if (parsed.pathname !== "/auth/magic") {
      return {
        message: "Magic link must target /auth/magic.",
        details: {
          expectedPath: "/auth/magic",
          actualPath: parsed.pathname
        }
      };
    }
    if (!parsed.searchParams.get("token")) {
      return {
        message: "Magic link is missing its token parameter.",
        details: {
          origin: parsed.origin,
          path: parsed.pathname
        }
      };
    }
  } catch {
    return {
      message: "Magic link URL is invalid.",
      details: {}
    };
  }
  return null;
}

function checkAuthPreconditions() {
  if (!requireAuth || !baseUrl || !publicLiveTarget()) return;

  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "https:") {
    fail("live_auth_precondition", "Public authenticated live smoke requires a HTTPS app URL.", {
      origin: parsed.origin,
      protocol: parsed.protocol
    });
    return;
  }

  if (!magicLink) {
    fail("live_auth_precondition", "Public authenticated live smoke requires an explicit Resend magic link.", {
      required: "LEARNBUDDY_LIVE_SMOKE_MAGIC_LINK or --magic-link"
    });
    return;
  }

  const magicLinkProblem = magicLinkTargetProblem(magicLink, { requireAbsoluteHttps: true });
  if (magicLinkProblem) {
    fail("live_auth_precondition", magicLinkProblem.message, magicLinkProblem.details);
  }
}

async function fetchJson(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    let payload = null;
    if (text.trim()) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }
    return { response, payload, text };
  } finally {
    clearTimeout(timeout);
  }
}

function attachBrowserDiagnostics(page) {
  const problems = [];
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
  return problems;
}

async function visible(locator, timeout = 1000) {
  try {
    await locator.waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

async function waitForInteractivePage(page, timeoutMs) {
  try {
    await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 8_000) });
  } catch {
    // Public previews can keep lightweight requests open; visible UI checks below remain authoritative.
  }
}

async function openQuizDrawer(page, opener, timeoutMs) {
  const drawer = page.getByLabel("Quizfrage");
  await opener.click();
  if (await visible(drawer, 2_000)) return;

  await waitForInteractivePage(page, timeoutMs);
  await opener.click();
  await drawer.waitFor({ state: "visible", timeout: timeoutMs });
}

function failOnDiagnostics(id, problems) {
  if (problems.length > 0) {
    fail(id, "Browser diagnostics reported problems.", { problems: problems.map(sanitize) });
    return false;
  }
  return true;
}

async function checkHealth(timeoutMs) {
  try {
    const { response, payload } = await fetchJson(appUrl("/api/health"), timeoutMs);
    if (!response.ok || payload?.ok !== true) {
      fail("health", "Health endpoint did not report ok=true.", {
        status: response.status,
        checks: payload?.checks ?? null
      });
      return;
    }
    pass("health", "Health endpoint reports ok=true.", {
      status: response.status,
      checks: payload.checks
    });
  } catch (error) {
    fail("health", error);
  }
}

async function checkStudentLive(page, token, timeoutMs) {
  const problems = attachBrowserDiagnostics(page);
  await page.goto(appUrl(`/l/${token}`), { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await waitForInteractivePage(page, timeoutMs);
  await page.getByPlaceholder("z. B. LagerProfi42").fill(`Smoke ${Date.now().toString(36)}`);
  await page.getByRole("button", { name: "Teilnehmen" }).click();
  await page.locator('[data-slide-engine="v1"]').waitFor({ state: "visible", timeout: timeoutMs });
  await page.getByLabel("Quizfrage").waitFor({ state: "visible", timeout: timeoutMs });
  await page.locator(".question-drawer .answer").first().click();
  await page.locator(".toast-inline").waitFor({ state: "visible", timeout: timeoutMs });

  const leaderboardButton = page.getByRole("button", { name: "Leaderboard anzeigen" });
  const leaderboardAvailable = await visible(leaderboardButton, 2000);
  if (leaderboardAvailable) {
    await leaderboardButton.click();
    await page.getByRole("complementary", { name: "Leaderboard" }).waitFor({ state: "visible", timeout: timeoutMs });
  }

  if (!failOnDiagnostics("student_live_browser", problems)) return;
  pass("student_live_browser", "Student Live flow works in a fresh browser context.", {
    lectureToken: token,
    slideEngine: "v1",
    leaderboardChecked: leaderboardAvailable
  });
}

async function checkLearn(page, token, timeoutMs, includeAI, requireAIProvider) {
  const problems = attachBrowserDiagnostics(page);
  let aiState = null;
  await page.goto(appUrl(`/learn/${token}`), { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await waitForInteractivePage(page, timeoutMs);
  await page.locator('[data-slide-engine="v1"]').waitFor({ state: "visible", timeout: timeoutMs });
  const hotspot = page.getByLabel(/Frage Niveau .* anzeigen/).first();
  await page.getByLabel("Fragen-Hotspots").locator("button").first().waitFor({ state: "visible", timeout: timeoutMs });
  await openQuizDrawer(page, hotspot, timeoutMs);
  await page.locator(".question-drawer .answer").first().click();
  await page.locator(".question-drawer[data-answer-state='answered']").waitFor({ state: "visible", timeout: timeoutMs });
  await page.getByRole("button", { name: "KI fragen" }).click();
  const chatPanel = page.getByLabel("KI Chat");
  await chatPanel.waitFor({ state: "visible", timeout: timeoutMs });

  if (includeAI) {
    await page.getByRole("button", { name: "Senden" }).click();
    await page.waitForFunction(() => {
      const panel = document.querySelector('[aria-label="KI Chat"]');
      const state = panel?.getAttribute("data-ai-answer-state");
      return state === "answered" || state === "error";
    }, null, { timeout: timeoutMs });
    aiState = await chatPanel.evaluate((element) => ({
      answerState: element.getAttribute("data-ai-answer-state") ?? "",
      provider: element.getAttribute("data-ai-provider") ?? "",
      model: element.getAttribute("data-ai-model") ?? "",
      streamSource: element.getAttribute("data-ai-stream-source") ?? "",
      text: element.textContent ?? ""
    }));
    if (aiState.answerState === "error") {
      fail("learn_ai_browser", "Learn AI chat returned an error.", aiState);
      return;
    }
    if (requireAIProvider && (aiState.streamSource !== "provider" || !aiState.provider || aiState.provider === "local")) {
      fail("learn_ai_browser", "Learn AI chat answered, but provider-backed stream was not visible.", aiState);
      return;
    }
    await page.locator(".chat-body").getByText(/Tokens|Quelle|Mock-Erklärung|Erklärung/i).first().waitFor({
      state: "visible",
      timeout: Math.min(timeoutMs, 5000)
    });
  }
  await page.getByLabel("Chat schließen").click();
  await page.getByLabel("KI Chat").waitFor({ state: "hidden", timeout: timeoutMs });

  const leaderboardButton = page.getByRole("button", { name: "Leaderboard anzeigen" });
  const leaderboardAvailable = await visible(leaderboardButton, 2000);
  if (leaderboardAvailable) {
    await leaderboardButton.click();
    await page.getByRole("complementary", { name: "Leaderboard" }).waitFor({ state: "visible", timeout: timeoutMs });
  }

  if (!failOnDiagnostics("learn_browser", problems)) return;
  pass("learn_browser", "Learn mode flow works in a fresh browser context.", {
    lectureToken: token,
    slideEngine: "v1",
    aiRequested: includeAI,
    requireAIProvider,
    aiAnswerState: aiState?.answerState ?? null,
    aiProvider: aiState?.provider ?? null,
    aiModel: aiState?.model ?? null,
    aiStreamSource: aiState?.streamSource ?? null,
    leaderboardChecked: leaderboardAvailable
  });
}

async function checkLecturerAssistant(page, timeoutMs, requireProvider) {
  const panel = page.getByLabel("Planungsassistent direkt an der Folie");
  await page.getByRole("button", { name: "Assistent an dieser Folie" }).click();
  await panel.waitFor({ state: "visible", timeout: timeoutMs });
  await panel.getByLabel("Nachricht an den Planungsassistenten").fill("Live-Smoke: Welche Erklärung passt direkt auf diese Folie?");
  await panel.getByRole("button", { name: "Senden" }).click();
  await panel.locator(".assistant-message.assistant").last().waitFor({ state: "visible", timeout: timeoutMs });
  await page.reload({ waitUntil: "domcontentloaded", timeout: timeoutMs });
  await page.getByRole("button", { name: "Assistent an dieser Folie" }).click();
  await panel.waitFor({ state: "visible", timeout: timeoutMs });
  await panel.locator(".assistant-message.assistant").last().waitFor({ state: "visible", timeout: timeoutMs });

  const providerVisible = await visible(panel.getByText("AIProvider genutzt").last(), 1500);
  if (requireProvider && !providerVisible) {
    fail("lecturer_assistant_browser", "Lecturer assistant answered, but provider-backed Agent step was not visible.");
    return;
  }

  pass("lecturer_assistant_browser", "Lecturer assistant answered in the studio UI and persisted after reload.", {
    providerStepVisible: providerVisible
  });
}

async function waitForLecturerStudio(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  const editorTitle = page.getByRole("textbox", { name: "Folientitel" });
  const createDialog = page.getByRole("dialog", { name: "Neue Vorlesung als Folie anlegen" });

  while (Date.now() < deadline) {
    if (await visible(editorTitle, 500)) return "lecture-editor";
    if (await visible(createDialog, 500)) {
      await page.getByRole("textbox", { name: "Titel" }).waitFor({ state: "visible", timeout: 2_000 });
      return "create-lecture";
    }
  }

  return null;
}

async function checkLecturerAuth(page, timeoutMs, email, magicLink, requireAuth, includeAssistant, requireAssistantProvider) {
  const problems = attachBrowserDiagnostics(page);
  await page.goto(appUrl("/lecturer/login"), { waitUntil: "domcontentloaded", timeout: timeoutMs });
  if (email) {
    await page.getByLabel("E-Mail").fill(email);
    await page.getByRole("button", { name: "Magic Link senden" }).click();
  }

  let link = magicLink;
  const localLink = page.getByRole("link", { name: "Referentenbereich öffnen" });
  if (!link && await visible(localLink, 1500)) {
    const href = await localLink.getAttribute("href");
    if (href) link = new URL(href, page.url()).toString();
  }

  if (!link) {
    const message = "No lecturer magic link was available. Set LEARNBUDDY_LIVE_SMOKE_MAGIC_LINK after requesting the Resend email.";
    if (requireAuth) {
      fail("lecturer_auth_browser", message);
    } else {
      warn("lecturer_auth_browser", message, { requestedEmail: Boolean(email) });
    }
    return;
  }

  const magicLinkProblem = magicLinkTargetProblem(link, {
    requireAbsoluteHttps: requireAuth && publicLiveTarget()
  });
  if (magicLinkProblem) {
    fail("lecturer_auth_browser", magicLinkProblem.message, magicLinkProblem.details);
    return;
  }

  await page.goto(new URL(link, baseUrl).toString(), { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await page.waitForURL(/\/lecturer$/, { timeout: timeoutMs });
  const studioState = await waitForLecturerStudio(page, timeoutMs);
  if (!studioState) {
    fail("lecturer_auth_browser", "Lecturer login succeeded, but the lecturer studio did not become usable.");
    return;
  }
  await page.reload({ waitUntil: "domcontentloaded", timeout: timeoutMs });
  const reloadedStudioState = await waitForLecturerStudio(page, timeoutMs);
  if (!reloadedStudioState) {
    fail("lecturer_auth_browser", "Lecturer studio was not usable after authenticated reload.");
    return;
  }

  if (includeAssistant) {
    if (studioState !== "lecture-editor") {
      fail("lecturer_assistant_browser", "Lecturer assistant smoke requires an existing lecture editor, but the account opened the create-lecture view.");
      return;
    }
    await checkLecturerAssistant(page, timeoutMs, requireAssistantProvider);
  }

  await page.getByLabel("Studio-Menü").click();
  await page.getByRole("link", { name: "Logout" }).click();
  await page.waitForURL((url) => url.pathname === "/" || url.pathname === "/lecturer/login", { timeout: timeoutMs });
  await page.goto(appUrl("/lecturer"), { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await page.waitForURL(/\/lecturer\/login/, { timeout: timeoutMs });

  if (!failOnDiagnostics("lecturer_auth_browser", problems)) return;
  pass("lecturer_auth_browser", "Lecturer login, authenticated reload and logout worked.", {
    requestedEmail: Boolean(email),
    magicLinkSource: magicLink ? "provided" : "local-console",
    studioState,
    reloadedStudioState
  });
}

async function runBrowserChecks(timeoutMs) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: !args.has("headed") });
  try {
    const publicContext = await browser.newContext();
    try {
      await checkStudentLive(await publicContext.newPage(), lectureToken, timeoutMs);
      await checkLearn(await publicContext.newPage(), lectureToken, timeoutMs, includeAI, requireAIProvider);
    } finally {
      await publicContext.close();
    }

    if (includeAuth || requireAuth || includeAssistant || smokeEmail || magicLink) {
      const authContext = await browser.newContext();
      try {
        await checkLecturerAuth(await authContext.newPage(), timeoutMs, smokeEmail, magicLink, requireAuth, includeAssistant, requireAssistantProvider);
      } finally {
        await authContext.close();
      }
    } else {
      skip("lecturer_auth_browser", "Skipped. Pass --auth with --email and provide LEARNBUDDY_LIVE_SMOKE_MAGIC_LINK for production auth smoke.");
    }
  } finally {
    await browser.close();
  }
}

const timeoutMs = configuredTimeoutMs();
let baseUrl;
try {
  baseUrl = normalizeBaseUrl(args.get("url") || envValue("LEARNBUDDY_LIVE_SMOKE_URL") || envValue("NEXT_PUBLIC_APP_URL"));
} catch (error) {
  fail("configuration", error);
}

const lectureToken = (args.get("lecture-token") || envValue("LEARNBUDDY_LIVE_SMOKE_LECTURE_TOKEN") || DEFAULT_LECTURE_TOKEN).trim();
const requireAIProvider = args.has("require-ai-provider") || envValue("LEARNBUDDY_LIVE_SMOKE_REQUIRE_AI_PROVIDER") === "1";
const includeAI = args.has("include-ai") || requireAIProvider || envValue("LEARNBUDDY_LIVE_SMOKE_INCLUDE_AI") === "1";
const includeAssistant = args.has("include-assistant") || envValue("LEARNBUDDY_LIVE_SMOKE_INCLUDE_ASSISTANT") === "1";
const requireAssistantProvider = args.has("require-assistant-provider") || envValue("LEARNBUDDY_LIVE_SMOKE_REQUIRE_ASSISTANT_PROVIDER") === "1";
const includeAuth = args.has("auth") || envValue("LEARNBUDDY_LIVE_SMOKE_AUTH") === "1";
const requireAuth = args.has("require-auth") || envValue("LEARNBUDDY_LIVE_SMOKE_REQUIRE_AUTH") === "1";
const smokeEmail = (args.get("email") || envValue("LEARNBUDDY_LIVE_SMOKE_EMAIL")).trim();
const magicLink = (args.get("magic-link") || envValue("LEARNBUDDY_LIVE_SMOKE_MAGIC_LINK")).trim();

if (baseUrl) {
  const targetProblem = liveTargetProblem();
  if (targetProblem) {
    fail("live_target", targetProblem.message, targetProblem.details);
  }
  checkAuthPreconditions();
  if (!checks.some((check) => check.status === "fail")) {
    await checkHealth(timeoutMs);
    try {
      await runBrowserChecks(timeoutMs);
    } catch (error) {
      fail("browser", error);
    }
  }
}

const summary = {
  total: checks.length,
  passed: checks.filter((check) => check.status === "pass").length,
  warnings: checks.filter((check) => check.status === "warn").length,
  skipped: checks.filter((check) => check.status === "skip").length,
  failed: checks.filter((check) => check.status === "fail").length
};
const blockers = checks
  .filter((check) => check.status === "fail")
  .map((check) => ({
    id: check.id,
    status: check.status,
    message: check.message,
    details: check.details
  }));
const ok = summary.failed === 0;

console.log(JSON.stringify({
  ok,
  command: "live-smoke",
  baseUrl: baseUrl ?? null,
  lectureToken,
  includeAI,
  requireAIProvider,
  includeAssistant,
  requireAssistantProvider,
  checks,
  blockers,
  summary
}, null, 2));

process.exit(ok ? 0 : 1);
