import { expect, test, type Locator, type Page } from "@playwright/test";

// Parent runs this with the combined build, after importing ui-app-consistency.
// Uses the existing seeded gleitlagerung demo and isolated test-account fixtures.
// No editor/live assertions, extra browser contexts, or test-owned servers.
const token = "gleitlagerung-demo";
const password = "e2e-only-test-password-not-for-production";
const variants = [
  { name: "desktop light", colorScheme: "light", viewport: { width: 1280, height: 800 } },
  { name: "desktop dark", colorScheme: "dark", viewport: { width: 1280, height: 800 } },
  { name: "mobile light", colorScheme: "light", viewport: { width: 390, height: 844 } },
  { name: "compact dark", colorScheme: "dark", viewport: { width: 320, height: 500 } }
] as const;

function diagnostics(page: Page) {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 500) problems.push(`${response.status()} ${response.url()}`);
  });
  page.on("requestfailed", (request) => {
    // Full document navigations can cancel requests from the previous route.
    if (!request.failure()?.errorText.includes("ERR_ABORTED")) {
      problems.push(`${request.failure()?.errorText} ${request.url()}`);
    }
  });
  return () => expect(problems, problems.join("\n")).toEqual([]);
}

async function fitsViewport(page: Page, locator: Locator) {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
}

async function panelContract(page: Page, panel: Locator) {
  await fitsViewport(page, panel);
  await expect(panel).toHaveCSS("border-radius", "12px");
  await expect(panel).toHaveCSS("font-family", /Learnordie Assistant/);
  await expect(panel).toHaveCSS("background-image", "none");
  const dark = await page.evaluate(() => document.documentElement.dataset.theme === "dark" ||
    (!document.documentElement.dataset.theme && matchMedia("(prefers-color-scheme: dark)").matches));
  await expect(panel).toHaveCSS("background-color", dark ? "rgb(35, 35, 41)" : "rgb(255, 255, 255)");
  await expect(panel).toHaveCSS("color", dark ? "rgb(241, 240, 245)" : "rgb(27, 27, 31)");
}

async function controlContract(page: Page, control: Locator) {
  await fitsViewport(page, control);
  await expect(control).toHaveCSS("border-radius", "8px");
  await expect(control).toHaveCSS("font-family", /Learnordie Assistant/);
  const box = await control.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
}

async function keyboardFocus(control: Locator) {
  await control.focus();
  // Tab away and back selects keyboard focus, including on WebKit-style inputs.
  await control.press("Tab");
  await control.page().keyboard.press("Shift+Tab");
  await expect(control).toBeFocused();
  await expect(control).toHaveCSS("outline-style", "solid");
  await expect(control).toHaveCSS("outline-width", "2px");
}

for (const variant of variants) {
  test.describe(variant.name, () => {
    test.use({ viewport: variant.viewport, colorScheme: variant.colorScheme, contextOptions: { reducedMotion: "reduce" } });

    test("entry, unknown join, onboarding and test-login controls share the shell", async ({ page }, testInfo) => {
      const assertClean = diagnostics(page);
      await page.goto("/");
      await panelContract(page, page.locator(".home-join-island"));
      const code = page.getByLabel("Vorlesungscode", { exact: true });
      await controlContract(page, code);
      await keyboardFocus(code);
      await controlContract(page, page.getByRole("button", { name: "Runde starten" }));
      await code.fill("DESIGN-CODE-NOT-FOUND");
      await page.getByRole("button", { name: "Runde starten" }).click();
      await expect(page.getByRole("heading", { name: "Diesen Code kennen wir nicht" })).toBeVisible();
      const join = page.getByRole("dialog");
      await panelContract(page, join);
      await controlContract(page, page.getByLabel("Code erneut eingeben"));
      // The full-page join dialog keeps keyboard navigation inside its island.
      await join.getByRole("link", { name: "Zur Startseite" }).focus();
      await page.keyboard.press("Tab");
      await expect(page.getByLabel("Code erneut eingeben")).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(page).toHaveURL(/\/$/);

      await page.getByRole("link", { name: "Dashboard öffnen" }).click();
      await expect(page.getByRole("heading", { name: "Wähle ein Pseudonym" })).toBeVisible();
      await panelContract(page, page.locator(".student-emptystate"));
      await controlContract(page, page.getByRole("button", { name: "Neue Vorschläge" }));
      const suggestion = page.locator(".pseudonym-suggestion").first();
      await expect(suggestion).toBeEnabled();
      await suggestion.click();
      await expect(suggestion).toHaveAttribute("aria-pressed", "true");
      await controlContract(page, suggestion);
      await controlContract(page, page.getByLabel("Eigenes Pseudonym"));

      await page.goto("/lecturer/login");
      await panelContract(page, page.locator(".login-card"));
      const summary = page.locator(".test-account-login > summary");
      await controlContract(page, summary);
      await summary.focus();
      await page.keyboard.press("Enter");
      await expect(page.locator(".test-account-login")).toHaveAttribute("open", "");
      await controlContract(page, page.getByLabel("Testkonto E-Mail", { exact: true }));
      await controlContract(page, page.getByLabel("Testkonto Passwort", { exact: true }));
      await controlContract(page, page.getByRole("button", { name: "Testkonto öffnen" }));
      await testInfo.attach("entry-login", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
      await page.goto("/lecturer/login?error=invalid-token");
      await expect(page.getByRole("alert")).toContainText("Dieser Link ist abgelaufen");
      await fitsViewport(page, page.getByRole("alert"));
      await expect(page.getByRole("alert")).toHaveCSS("border-radius", "8px");
      await page.getByRole("link", { name: "Zur Startseite" }).click();
      await expect(page.locator(".home-app")).toBeVisible();
      assertClean();
    });

    test("student dashboard, rename, series and event preserve readable route contracts", async ({ page }, testInfo) => {
      const assertClean = diagnostics(page);
      // Established fixture pattern: direct Learn entry creates a lazy enrollment.
      await page.goto(`/learn/${token}`);
      await expect(page.locator("main.learn-shell")).toBeVisible();
      await expect.poll(async () => (await (await page.request.get("/api/student/dashboard")).json()).dashboard?.series?.length).toBe(1);
      const { dashboard } = await (await page.request.get("/api/student/dashboard")).json();
      const series = dashboard.series[0];
      await page.goto("/student");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Meine Vorlesungen");
      await panelContract(page, page.locator(".student-series"));
      await page.getByRole("button", { name: "Pseudonym ändern" }).click();
      const input = page.getByLabel("Bevorzugter Name", { exact: true });
      const original = await input.inputValue();
      await input.fill("SehrLangerBevorzugterNameFürSchmaleGeräte");
      await controlContract(page, input);
      await controlContract(page, page.locator(".student-id").getByRole("button", { name: "Abbrechen" }));
      await page.locator(".student-id").getByRole("button", { name: "Abbrechen" }).click();
      await page.getByRole("button", { name: "Pseudonym ändern" }).click();
      await expect(input).toHaveValue(original);
      await page.locator(".student-id").getByRole("button", { name: "Abbrechen" }).click();
      await page.getByRole("button", { name: "Anzeigename ändern" }).click();
      const seriesName = page.getByLabel("Name in dieser Vorlesung", { exact: true });
      await seriesName.fill(`Design-${testInfo.workerIndex}-${Date.now()}`);
      const savedName = await seriesName.inputValue();
      await controlContract(page, seriesName);
      await page.locator(".student-series").getByRole("button", { name: "Speichern", exact: true }).click();
      await expect(seriesName).toHaveCount(0);
      await page.reload();
      await expect(page.locator(".student-series-meta")).toContainText(savedName);
      const claim = await (await page.request.get(`/api/student/claim?seriesId=${series.seriesId}`)).json();
      expect(claim.claim.displayName).toBe(savedName);
      const seriesLink = page.getByRole("heading", { level: 2 }).getByRole("link", { name: series.seriesTitle });
      await seriesLink.click();
      await expect(page).toHaveURL(new RegExp(`/student/series/${series.seriesId}$`));
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(series.seriesTitle);
      await panelContract(page, page.locator(".student-series"));
      const eventLink = page.locator("a.student-event-title").first();
      const eventTitle = await eventLink.innerText();
      await fitsViewport(page, eventLink);
      await eventLink.click();
      await expect(page).toHaveURL(/\/student\/events\//);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(eventTitle);
      await panelContract(page, page.locator(".student-series"));
      await testInfo.attach("student-event", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
      await page.getByRole("link", { name: "Zurück zum Dashboard" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Meine Vorlesungen");
      assertClean();
    });

    test("Learn menu density, leaderboard and feedback overlay remain keyboard reachable", async ({ page }, testInfo) => {
      const assertClean = diagnostics(page);
      await page.goto(`/learn/${token}`);
      await expect(page.locator("main.learn-shell")).toBeVisible();
      const menu = page.locator(".learn-more");
      const summary = menu.locator("summary");
      await keyboardFocus(summary);
      await page.keyboard.press("Enter");
      await expect(menu).toHaveAttribute("open", "");
      await panelContract(page, page.locator(".learn-more-panel"));
      const download = menu.getByRole("link", { name: "Lern-HTML herunterladen" });
      await controlContract(page, download);
      await expect(download).toHaveAttribute("href", `/api/lecture/${token}/export`);
      const density = menu.getByRole("slider", { name: "Fragedichte" });
      await density.focus();
      await density.press("Home");
      await density.press("ArrowRight");
      await expect(menu.locator(".learn-more-density strong")).toHaveText(await density.inputValue());
      await fitsViewport(page, density);
      await menu.getByRole("button", { name: "Rangliste", exact: true }).click();
      const leaderboard = page.getByRole("complementary", { name: "Rangliste", exact: true });
      await panelContract(page, leaderboard);
      const closeLeaderboard = leaderboard.getByRole("button", { name: "Rangliste schließen" });
      await controlContract(page, closeLeaderboard);
      await closeLeaderboard.click();
      await expect(leaderboard).toHaveCount(0);
      // Opening an overlay may close the disclosure; normalize using its state.
      if (!(await menu.evaluate((element) => (element as HTMLDetailsElement).open))) await summary.click();
      await menu.getByRole("button", { name: "Evaluation", exact: true }).click();
      const evaluation = page.getByRole("complementary", { name: "Evaluation", exact: true });
      await panelContract(page, evaluation);
      const comment = evaluation.getByLabel("Evaluationskommentar");
      await comment.fill("Lesbare Bedienelemente auf kleinem Bildschirm.");
      await controlContract(page, comment);
      const send = evaluation.getByRole("button", { name: "Evaluation senden" });
      await send.scrollIntoViewIfNeeded();
      await controlContract(page, send);
      const close = evaluation.getByRole("button", { name: "Evaluation schließen" });
      await close.scrollIntoViewIfNeeded();
      await controlContract(page, close);
      await testInfo.attach("learn-evaluation", { body: await page.screenshot(), contentType: "image/png" });
      await close.click();
      await expect(evaluation).toHaveCount(0);
      if (await menu.evaluate((element) => (element as HTMLDetailsElement).open)) await summary.click();
      await page.getByRole("button", { name: "Quiz (Leertaste)", exact: true }).click();
      await expect(page.locator(".question-drawer")).toBeVisible();
      await page.locator(".question-ai-link").click();
      const chat = page.getByRole("complementary", { name: "KI Chat", exact: true });
      await panelContract(page, chat);
      const chatInput = chat.getByLabel("Eigene Frage", { exact: true });
      await controlContract(page, chatInput);
      await expect(chat.getByRole("button", { name: "Fragen", exact: true })).toBeDisabled();
      await chatInput.fill("Wie entsteht der Schmierfilm?");
      await expect(chat.getByRole("button", { name: "Fragen", exact: true })).toBeEnabled();
      await controlContract(page, chat.getByRole("button", { name: "Chat schließen" }));
      await chat.getByRole("button", { name: "Chat schließen" }).click();
      await expect(chat).toHaveCount(0);
      assertClean();
    });
  });
}

test("OTP, theme persistence, test login and logout return to the same entry shell", async ({ page }, testInfo) => {
  const assertClean = diagnostics(page);
  await page.emulateMedia({ colorScheme: "light", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/lecturer/login");
  await page.getByLabel("E-Mail", { exact: true }).fill(`design-${Date.now()}@example.test`);
  const sent = page.waitForResponse((response) => response.url().endsWith("/api/auth/magic-link") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Code senden", exact: true }).click();
  const delivery = await sent;
  expect(delivery.ok()).toBe(true);
  const payload = await delivery.json();
  expect(payload.code, "Requires the existing isolated console-mail fixture").toMatch(/^\d{6}$/);
  const otp = page.getByLabel("Code", { exact: true });
  await expect(otp).toBeFocused();
  await expect(otp).toHaveAttribute("autocomplete", "one-time-code");
  await expect(otp).toHaveAttribute("aria-describedby", "login-code-hint");
  await expect(page.getByRole("button", { name: "Anmelden", exact: true })).toBeDisabled();
  await otp.fill(payload.code);
  await page.getByRole("button", { name: "Dunkles Design", exact: true }).click();
  await expect(otp).toHaveValue(payload.code);
  await panelContract(page, page.locator(".login-card"));
  await controlContract(page, otp);
  await controlContract(page, page.getByRole("button", { name: "Neuen Code senden" }));
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page).toHaveURL(/\/lecturer$/);
  await page.reload();
  await expect(page).toHaveURL(/\/lecturer$/);
  // Create only this test's series using the established authenticated API fixture.
  const csrf = await page.locator("[data-csrf-token]").getAttribute("data-csrf-token");
  expect(csrf).toBeTruthy();
  const seriesTitle = `DarstellungLangerVorlesungsnamenOhneTrennzeichen-${Date.now()}`;
  const created = await page.request.post("/api/lectures", {
    headers: { "x-learnbuddy-csrf": csrf! },
    data: { title: "Darstellung und Navigation", seriesTitle, liveAt: "2030-12-01T10:00:00.000Z", examDate: "2030-12-02" }
  });
  expect(created.status()).toBe(201);
  const { lecture } = await created.json();
  const joinCode = `DESIGN-${Date.now()}`;
  const assigned = await page.request.patch(`/api/lecturer/series/${lecture.seriesId}/join-code`, {
    headers: { "x-learnbuddy-csrf": csrf! }, data: { code: joinCode }
  });
  expect(assigned.ok()).toBe(true);
  await page.goto("/api/auth/logout");
  await expect(page).toHaveURL(/\/$/);
  await panelContract(page, page.locator(".home-join-island"));
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.goto("/lecturer");
  await expect(page).toHaveURL(/\/lecturer\/login$/);
  await panelContract(page, page.locator(".login-card"));
  await page.locator(".test-account-login > summary").click();
  await page.getByLabel("Testkonto E-Mail", { exact: true }).fill("qa-other@learnordie.test");
  await page.getByLabel("Testkonto Passwort", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Testkonto öffnen" }).click();
  await expect(page).toHaveURL(/\/lecturer$/);
  await page.reload();
  await expect(page).toHaveURL(/\/lecturer$/);
  await page.goto("/api/auth/logout");
  await page.goto("/lecturer");
  await expect(page).toHaveURL(/\/lecturer\/login$/);
  await testInfo.attach("logged-out-dark", { body: await page.screenshot(), contentType: "image/png" });
  // Positive join is independent of manually configured demo join codes.
  await page.goto(`/join/${joinCode}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(seriesTitle);
  await panelContract(page, page.getByRole("dialog"));
  await page.getByLabel("Eigenes Pseudonym").fill(`Beitritt-${Date.now()}`);
  await controlContract(page, page.getByLabel("Eigenes Pseudonym"));
  await page.getByRole("button", { name: "Beitreten", exact: true }).click();
  await expect(page).toHaveURL(/\/student/);
  await expect(page.getByRole("heading", { name: seriesTitle })).toBeVisible();
  await panelContract(page, page.locator(".student-series"));
  await page.reload();
  await expect(page.getByRole("heading", { name: seriesTitle })).toBeVisible();
  assertClean();
});
