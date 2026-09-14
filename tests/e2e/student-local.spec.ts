import { expect, type Page, test } from "@playwright/test";

// Clean-profile student flows against the LOCAL store.
// Each test uses a fresh browser context, so the student has no cookies/localStorage —
// a true clean profile. Run with playwright.local.config.ts against a running dev server.

const JOIN_CODE = "ME1-GL-2026";
const SERIES_TITLE = "Maschinenelemente I";

function attachDiagnostics(page: Page) {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) {
      problems.push(`console:${message.text()}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`pageerror:${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 500) problems.push(`response:${response.status()} ${response.url()}`);
  });
  return () => expect(problems, problems.join("\n")).toEqual([]);
}

const LECTURER_EMAIL = process.env.LOCAL_E2E_LECTURER_EMAIL ?? "referent@example.com";

async function loginLecturerAndSetCode(page: Page, code: string) {
  await page.goto("/lecturer/login");
  await page.getByLabel("E-Mail", { exact: true }).fill(LECTURER_EMAIL);
  await page.getByRole("button", { name: "Code senden" }).click();
  const link = page.getByRole("link", { name: "Direkt zum Dozentenbereich" });
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  await page.goto(href!);
  await expect(page).toHaveURL(/\/lecturer$/);

  // Open the studio command menu and set the join code for the series.
  await page.locator(".studio-command-menu summary").click();
  const codeInput = page.locator(".join-code-form input");
  await expect(codeInput).toBeVisible();
  await codeInput.fill(code);
  await page.locator(".join-code-form button[type=submit]").click();
  await expect(page.locator(".join-code-value")).toHaveText(code);
}

test("Dozent setzt Code, Student tritt mit Pseudonym bei und sieht das Dashboard", async ({ browser }) => {
  // Lecturer sets the join code (authentic source — no seed).
  const lecturerCtx = await browser.newContext();
  const lecturerPage = await lecturerCtx.newPage();
  const assertLecturerClean = attachDiagnostics(lecturerPage);
  await loginLecturerAndSetCode(lecturerPage, JOIN_CODE);
  assertLecturerClean();
  await lecturerCtx.close();

  // Fresh student: clean profile, no cookies.
  const studentCtx = await browser.newContext();
  const page = await studentCtx.newPage();
  const assertClean = attachDiagnostics(page);

  await page.goto("/");
  await expect(page.getByRole("region", { name: "An Vorlesung teilnehmen" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Vorlesung beitreten" })).toBeVisible();
  // Root must not be a demo slide / fake lecture.
  await expect(page.locator(".slide-screen")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Gleitlagerung" })).toHaveCount(0);

  await page.locator(".home-join-form input").fill(JOIN_CODE.toLowerCase());
  await page.locator(".home-join-form button[type=submit]").click();

  await expect(page).toHaveURL(new RegExp(`/join/`));
  await expect(page.getByRole("heading", { name: SERIES_TITLE })).toBeVisible();

  await expect(page.locator(".join-form .pseudonym-suggestion")).toHaveCount(3);
  await page.locator(".join-form .pseudonym-suggestion").first().click();
  await page.locator(".join-form button[type=submit]").click();

  await expect(page).toHaveURL(/\/student/);
  await expect(page.getByRole("heading", { name: SERIES_TITLE })).toBeVisible();

  // Persistence: reopening the dashboard keeps the enrollment.
  await page.reload();
  await expect(page.getByRole("heading", { name: SERIES_TITLE })).toBeVisible();

  assertClean();
  await studentCtx.close();
});

test("Unbekannter Code zeigt eine klare Fehlermeldung ohne Demo-Fallback", async ({ page }) => {
  const assertClean = attachDiagnostics(page);
  await page.goto("/join/CODE-GIBT-ES-NICHT");
  await expect(page.getByRole("heading", { name: "Diesen Code kennen wir nicht" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Gleitlagerung" })).toHaveCount(0);
  assertClean();
});

test("Root zeigt für ein bestehendes Profil den Dashboard-Einstieg", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // Create a profile via the join flow first.
  await page.goto(`/join/${JOIN_CODE}`);
  const pseudonymInput = page.locator(".join-form input");
  if (await pseudonymInput.isVisible().catch(() => false)) {
    await page.locator(".join-form .pseudonym-suggestion").first().click();
    await page.locator(".join-form button[type=submit]").click();
    await expect(page).toHaveURL(/\/student/);
  }
  // Now the root surfaces "Meine Vorlesungen".
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Zum Dashboard" })).toBeVisible();
  await ctx.close();
});

test("Zweiter Student kann denselben Namen in derselben Reihe nicht claimen", async ({ browser }) => {
  const takenName = `Welle-Test-${Date.now().toString().slice(-6)}`;
  const firstCtx = await browser.newContext();
  const first = await firstCtx.newPage();
  await first.goto("/join/TM-KB-2026");
  await first.getByLabel("Eigenes Pseudonym").fill(takenName);
  await first.locator(".join-form button[type=submit]").click();
  await expect(first).toHaveURL(/\/student/);
  await firstCtx.close();

  const secondCtx = await browser.newContext();
  const second = await secondCtx.newPage();
  await second.goto("/join/TM-KB-2026");
  await second.getByLabel("Eigenes Pseudonym").fill(takenName);
  await second.locator(".join-form button[type=submit]").click();
  await expect(second.locator(".form-error")).toContainText(/schon vergeben/i);
  await expect(second).not.toHaveURL(/\/student/);
  await secondCtx.close();
});

test("Learn-Ruhezustand auf 390×844: ein Zähler, Hotspots nicht über Text", async ({ browser }) => {
  const studentCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await studentCtx.newPage();
  await page.goto("/join/TM-KB-2026");
  await page.getByLabel("Eigenes Pseudonym").fill(`Mob-${Date.now().toString().slice(-5)}`);
  await page.locator(".join-form button[type=submit]").click();
  await expect(page).toHaveURL(/\/student/);
  await page.goto("/learn/tm-kombiniert-demo");
  await expect(page.locator(".slide-nav .slide-count")).toHaveCount(1);
  await expect(page.locator(".slide-nav")).toBeVisible();
  await expect(page.locator(".hotspots")).toBeVisible();
  await expect(page.getByText("Fragen")).toBeVisible();
  await studentCtx.close();
});

test("Dozentenlogin sendet Anmeldelink und erklärt abgelaufene Links", async ({ page }) => {
  await page.goto("/lecturer/login?error=invalid-token");
  await expect(page.getByRole("button", { name: "Code senden" })).toBeVisible();
  await expect(page.getByText(/abgelaufen/i)).toBeVisible();
});

test("Learn-Frage: antworten, Begründung, Folie ansehen, Weiterlernen", async ({ browser }) => {
  const studentCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await studentCtx.newPage();
  await page.goto("/join/TM-KB-2026");
  await page.getByLabel("Eigenes Pseudonym").fill(`T09-${Date.now().toString().slice(-5)}`);
  await page.locator(".join-form button[type=submit]").click();
  await expect(page).toHaveURL(/\/student/);
  await page.goto("/learn/tm-kombiniert-demo");
  await expect(page.locator("main.learn-shell")).toBeVisible();
  const hotspot = page.locator(".hotspots button").first();
  if (await hotspot.isVisible()) await hotspot.click();
  else await page.getByRole("button", { name: "Frage ein- oder ausklappen" }).click();
  await expect(page.locator(".question-drawer")).toBeVisible();
  await page.locator(".answer").first().click();
  await expect(page.locator(".question-feedback")).toContainText(/Richtig|Noch nicht richtig/);
  await expect(page.locator(".question-explanation")).toBeVisible();
  if (await page.getByRole("button", { name: "Folie ansehen" }).isVisible()) {
    await page.getByRole("button", { name: "Folie ansehen" }).click();
    await expect(page.getByRole("button", { name: "Zurück zur Frage" })).toBeVisible();
    await page.getByRole("button", { name: "Zurück zur Frage" }).click();
    await expect(page.locator(".question-feedback")).toBeVisible();
  }
  await page.getByRole("button", { name: "Weiterlernen" }).click();
  await expect(page.locator(".question-drawer")).toHaveCount(0);
  await studentCtx.close();
});

test("T10 Join: Fokus bleibt in der Insel, Escape zur Startseite", async ({ page }) => {
  await page.goto("/join/TM-KB-2026");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Tab");
  const dialog = page.getByRole("dialog");
  const handle = await dialog.elementHandle();
  const inside = await page.evaluate((root) => Boolean(root && root.contains(document.activeElement)), handle);
  expect(inside).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/$/);
});

test("T09 Peek erhält die gewählte Antwort", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto("/join/TM-KB-2026");
  await page.getByLabel("Eigenes Pseudonym").fill(`Peek-${Date.now().toString().slice(-5)}`);
  await page.locator(".join-form button[type=submit]").click();
  await expect(page).toHaveURL(/\/student/);
  await page.goto("/learn/tm-kombiniert-demo");
  await expect(page.locator("main.learn-shell")).toBeVisible();
  const hotspot = page.locator(".hotspots button").first();
  if (await hotspot.isVisible()) await hotspot.click();
  else await page.getByRole("button", { name: "Frage ein- oder ausklappen" }).click();
  await expect(page.locator(".question-drawer")).toBeVisible();
  await page.locator(".answer").nth(1).click();
  await expect(page.locator(".question-feedback")).toBeVisible();
  await page.getByRole("button", { name: "Folie ansehen" }).click();
  await expect(page.getByRole("button", { name: "Zurück zur Frage" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".question-feedback")).toBeVisible();
  await ctx.close();
});

test("T11 kleine Höhe: Frage bleibt in 320×500 erreichbar", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 500 } });
  const page = await ctx.newPage();
  await page.goto("/join/TM-KB-2026");
  await page.getByLabel("Eigenes Pseudonym").fill(`Hgt-${Date.now().toString().slice(-5)}`);
  await page.locator(".join-form button[type=submit]").click();
  await expect(page).toHaveURL(/\/student/);
  await page.goto("/learn/tm-kombiniert-demo");
  await expect(page.locator("main.learn-shell")).toBeVisible();
  const hotspot = page.locator(".hotspots button").first();
  if (await hotspot.isVisible()) await hotspot.click();
  else await page.getByRole("button", { name: "Frage ein- oder ausklappen" }).click();
  const drawer = page.locator(".question-drawer");
  await expect(drawer).toBeVisible();
  const box = await drawer.boundingBox();
  expect(box?.width ?? 999).toBeLessThanOrEqual(320);
  await expect(page.locator(".answers .answer").first()).toBeVisible();
  await ctx.close();
});

test("T01 Konfliktvorschläge enthalten den abgelehnten Namen nicht", async ({ browser }) => {
  const takenName = `Konflikt-${Date.now().toString().slice(-6)}`;
  const firstCtx = await browser.newContext();
  const first = await firstCtx.newPage();
  await first.goto("/join/TM-KB-2026");
  await first.getByLabel("Eigenes Pseudonym").fill(takenName);
  await first.locator(".join-form button[type=submit]").click();
  await expect(first).toHaveURL(/\/student/);
  await firstCtx.close();

  const secondCtx = await browser.newContext();
  const second = await secondCtx.newPage();
  await second.goto("/join/TM-KB-2026");
  await second.getByLabel("Eigenes Pseudonym").fill(takenName);
  await second.locator(".join-form button[type=submit]").click();
  await expect(second.locator(".form-error")).toContainText(/schon vergeben/i);
  await expect(second.getByLabel("Eigenes Pseudonym")).toHaveValue(takenName);
  const chips = second.locator(".join-form .pseudonym-suggestion");
  await expect(chips.first()).toBeVisible();
  const labels = await chips.allTextContents();
  expect(labels.map((item) => item.trim().toLowerCase())).not.toContain(takenName.toLowerCase());
  await expect(second.locator(".pseudonym-suggestion[aria-pressed=true]")).toHaveCount(0);
  await secondCtx.close();
});

test("T12 Join: Netzwerkfehler bleibt stehen und Retry gelingt", async ({ page }) => {
  let failOnce = true;
  await page.route("**/api/student/enrollments", async (route) => {
    if (route.request().method() === "POST" && failOnce) {
      failOnce = false;
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  const name = `Net-${Date.now().toString().slice(-5)}`;
  await page.goto("/join/TM-KB-2026");
  await page.getByLabel("Eigenes Pseudonym").fill(name);
  await page.locator(".join-form button[type=submit]").click();
  await expect(page.locator(".form-error")).toContainText(/Netzwerkfehler|erneut/i);
  await expect(page.getByLabel("Eigenes Pseudonym")).toHaveValue(name);
  await page.locator(".join-form button[type=submit]").click();
  await expect(page).toHaveURL(/\/student/);
});

test("T10 Frage: Tab bleibt im Drawer, Escape schließt", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto("/join/TM-KB-2026");
  await page.getByLabel("Eigenes Pseudonym").fill(`Esc-${Date.now().toString().slice(-5)}`);
  await page.locator(".join-form button[type=submit]").click();
  await expect(page).toHaveURL(/\/student/);
  await page.goto("/learn/tm-kombiniert-demo");
  const hotspot = page.locator(".hotspots button").first();
  if (await hotspot.isVisible()) await hotspot.click();
  else await page.getByRole("button", { name: "Frage ein- oder ausklappen" }).click();
  const drawer = page.locator(".question-drawer");
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Tab");
  const handle = await drawer.elementHandle();
  const inside = await page.evaluate((root) => Boolean(root && root.contains(document.activeElement)), handle);
  expect(inside).toBe(true);
  await page.keyboard.press("Escape");
  await expect(drawer).toHaveCount(0);
  await ctx.close();
});

test("T04 Formular begrenzt auf 40 Zeichen", async ({ page }) => {
  await page.goto("/join/TM-KB-2026");
  const input = page.getByLabel("Eigenes Pseudonym");
  await expect(input).toHaveAttribute("maxLength", "40");
});
