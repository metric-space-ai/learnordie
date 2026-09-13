import { expect, test, type Page } from "@playwright/test";
import { demoLecture } from "../../src/lib/demo-data";

const token = "gleitlagerung-demo";
const password = "e2e-only-test-password-not-for-production";

function captureDiagnostics(page: Page) {
  const failures: string[] = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") failures.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 500) failures.push(`${response.status()} ${response.url()}`);
  });
  return () => expect(failures, failures.join("\n")).toEqual([]);
}

async function openStudentMenu(page: Page) {
  if (page.viewportSize()!.width > 900) return;
  const menu = page.locator(".learn-more");
  if (!await menu.evaluate((node) => (node as HTMLDetailsElement).open)) {
    await menu.locator("summary").click();
  }
}

test("fresh entry remains compact and readable on desktop and mobile", async ({ page }) => {
  const assertClean = captureDiagnostics(page);
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Vorlesung beitreten");
    await expect(page.locator(".home-app")).toHaveCSS("border-radius", "0px");
    await expect(page.locator(".home-join-island")).toBeVisible();
    await expect(page.getByRole("button", { name: "Runde starten", exact: true })).toHaveCSS("background-color", "rgb(105, 101, 219)");
    await expect(page.getByLabel("Vorlesungscode", { exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  assertClean();
});

test("lecturer test login survives reload and logout blocks protected entry", async ({ page }) => {
  const assertClean = captureDiagnostics(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/lecturer/login");
  await page.locator(".test-account-login > summary").click();
  await page.getByLabel("Testkonto E-Mail", { exact: true }).fill("qa-other@learnordie.test");
  await page.getByLabel("Testkonto Passwort", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Testkonto öffnen", exact: true }).click();
  await expect(page).toHaveURL(/\/lecturer$/);
  await page.reload();
  await expect(page).toHaveURL(/\/lecturer$/);
  await page.goto("/api/auth/logout");
  await page.goto("/lecturer");
  await expect(page).toHaveURL(/\/lecturer\/login$/);
  await page.reload();
  await expect(page).toHaveURL(/\/lecturer\/login$/);
  assertClean();
});

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`fresh student can tune Learn, answer, and recover its leaderboard at ${viewport.width}px`, async ({ page }, testInfo) => {
    const assertClean = captureDiagnostics(page);
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(`/learn/${token}`);
    await expect(page.locator("main.learn-shell")).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

    await openStudentMenu(page);
    const density = page.getByRole("slider", { name: "Fragedichte", exact: true });
    await density.press("Home");
    await expect(page.locator(".hotspots button")).toHaveCount(1);
    await density.press("End");
    await expect(page.locator(".hotspots button")).toHaveCount(7);
    await density.press("Home");
    await density.press("ArrowRight");
    await density.press("ArrowRight");
    await expect(density).toHaveValue("3");

    if (viewport.width <= 900) await page.locator(".learn-more summary").click();
    const firstSlide = await page.locator("[data-slide-id]").first().getAttribute("data-slide-id");
    await page.getByRole("button", { name: "Nächste Folie", exact: true }).click();
    await expect(page.locator("[data-slide-id]").first()).not.toHaveAttribute("data-slide-id", firstSlide!);
    await page.getByRole("button", { name: "Nächste Folie", exact: true }).click();
    await expect(page.locator(".slide-nav")).toContainText("3 / 3");
    await page.reload();
    await openStudentMenu(page);
    await expect(density).toHaveValue("3");
    await expect(page.locator(".hotspots button")).toHaveCount(3);
    if (viewport.width <= 900) await page.locator(".learn-more summary").click();

    const question = demoLecture.questions.find((item) => item.level === "2.0")!;
    await page.getByRole("button", { name: "Quiz (Leertaste)", exact: true }).click();
    await expect(page.locator(".question-drawer .question")).toHaveText(question.text);
    await page.getByRole("button", { name: question.answers.find((item) => item.correct)!.text, exact: false }).click();
    await expect(page.locator(".learn-save-status")).toContainText("Antwort gespeichert");
    await page.getByRole("button", { name: "Weiterlernen", exact: true }).click();
    await openStudentMenu(page);
    await page.getByRole("button", { name: "Rangliste", exact: true }).filter({ visible: true }).click();
    await expect(page.locator(".leader-row.self strong")).toHaveText(String(question.points));
    const anonymousKey = (await page.context().cookies()).find((cookie) => cookie.name === "lb_student_key")?.value;
    expect(anonymousKey).toBeTruthy();
    const ranking = await page.request.get(`/api/lecture/${token}/leaderboard?anonymousKey=${encodeURIComponent(anonymousKey!)}`);
    expect(ranking.ok()).toBe(true);
    expect((await ranking.json()).entries.find((entry: { self: boolean }) => entry.self).points).toBe(question.points);
    await testInfo.attach(`luna-learn-score-${viewport.width}`, { body: await page.screenshot(), contentType: "image/png" });
    await page.reload();
    await openStudentMenu(page);
    await page.getByRole("button", { name: "Rangliste", exact: true }).filter({ visible: true }).click();
    await expect(page.locator(".leader-row.self strong")).toHaveText(String(question.points));
    await page.getByRole("button", { name: "Rangliste schließen", exact: true }).click();
    await page.getByRole("button", { name: "Dunkles Design", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("button", { name: "Dunkles Design", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("button", { name: "Dunkles Design", exact: true })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Dunkles Design", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.getByRole("button", { name: "Dunkles Design", exact: true })).toHaveAttribute("aria-pressed", "false");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    assertClean();
  });
}
