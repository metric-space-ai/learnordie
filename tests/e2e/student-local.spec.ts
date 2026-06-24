import { expect, type Page, test } from "@playwright/test";

// Clean-profile product flows against the LOCAL store (parallel-product-plan P1 / Welle 7).
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
  await page.getByLabel("E-Mail").fill(LECTURER_EMAIL);
  await page.getByRole("button", { name: "Magic Link senden" }).click();
  const link = page.getByRole("link", { name: "Referentenbereich öffnen" });
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
  await expect(page.getByRole("heading", { name: "Vorlesungscode rein, Lernrunde starten" })).toBeVisible();
  // Root must not be a demo slide / fake lecture.
  await expect(page.locator(".slide-screen")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Gleitlagerung" })).toHaveCount(0);

  await page.locator(".home-join-form input").fill(JOIN_CODE.toLowerCase());
  await page.locator(".home-join-form button[type=submit]").click();

  await expect(page).toHaveURL(new RegExp(`/join/`));
  await expect(page.getByRole("heading", { name: SERIES_TITLE })).toBeVisible();

  await page.locator(".join-form input").fill("Testpilot");
  await page.locator(".join-form button[type=submit]").click();

  await expect(page).toHaveURL(/\/student/);
  await expect(page.getByRole("heading", { name: SERIES_TITLE })).toBeVisible();
  await expect(page.getByText(`Code ${JOIN_CODE}`)).toBeVisible();

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
    await pseudonymInput.fill("Wiederkehrer");
    await page.locator(".join-form button[type=submit]").click();
    await expect(page).toHaveURL(/\/student/);
  }
  // Now the root surfaces "Zum Dashboard".
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Zum Dashboard" })).toBeVisible();
  await ctx.close();
});
