import { expect, test, type Page } from "@playwright/test";
import { demoLecture } from "../../src/lib/demo-data";

const token = "gleitlagerung-demo";

async function more(page: Page) {
  const menu = page.locator(".learn-more");
  if (!await menu.evaluate((node) => (node as HTMLDetailsElement).open)) await menu.locator("summary").click();
}

async function closeMore(page: Page) {
  const menu = page.locator(".learn-more");
  if (await menu.evaluate((node) => (node as HTMLDetailsElement).open)) await menu.locator("summary").click();
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  test(`Independent learning: density, slides, answers and persisted ranking at ${viewport.width}px`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    const failures: string[] = [];
    page.on("pageerror", (error) => failures.push(error.message));
    page.on("response", (response) => { if (response.status() >= 500) failures.push(`${response.status()} ${response.url()}`); });
    await page.goto(`/learn/${token}`);
    const stage = page.locator("[data-slide-id]").first();
    const firstSlide = await stage.getAttribute("data-slide-id");
    await more(page);
    const density = page.getByRole("slider", { name: "Fragedichte", exact: true });
    await density.press("End");
    await expect(density).toHaveAttribute("aria-valuetext", "jede Folie");
    await expect(page.locator(".hotspots button")).toHaveCount(4);
    await density.press("Home");
    await expect(density).toHaveAttribute("aria-valuetext", "alle 7 Folien");
    await expect(page.locator(".hotspots button")).toHaveCount(4);
    await density.press("ArrowRight");
    await density.press("ArrowRight");
    await expect(density).toHaveValue("3");
    await closeMore(page);
    await page.getByRole("button", { name: "Nächste Folie", exact: true }).click();
    await expect(stage).not.toHaveAttribute("data-slide-id", firstSlide!);
    await page.getByRole("button", { name: "Nächste Folie", exact: true }).click();
    await expect(page.getByRole("navigation", { name: "Foliennavigation" })).toContainText("3 / 3");
    await page.reload();
    await more(page);
    await expect(density).toHaveValue("3");
    await expect(page.locator(".hotspots button")).toHaveCount(4);
    await closeMore(page);
    await page.getByRole("button", { name: "Quiz (Leertaste)", exact: true }).click();
    const question = demoLecture.questions.find((item) => item.level === "2.0")!;
    await expect(page.locator(".question-drawer .question")).toHaveText(question.text);
    await page.getByRole("button", { name: question.answers.find((item) => item.correct)!.text, exact: false }).click();
    await expect(page.locator(".learn-save-status")).toContainText("Antwort gespeichert");
    await page.getByRole("button", { name: "Weiterlernen", exact: true }).click();
    await more(page);
    await page.getByRole("button", { name: "Rangliste", exact: true }).click();
    await expect(page.locator(".leader-row.self strong")).toHaveText(String(question.points));
    const identity = (await page.context().cookies()).find((cookie) => cookie.name === "lb_student_key")?.value;
    expect(identity).toBeTruthy();
    const leaderboard = await page.request.get(`/api/lecture/${token}/leaderboard?anonymousKey=${encodeURIComponent(identity!)}`);
    expect(leaderboard.ok()).toBe(true);
    expect((await leaderboard.json()).entries.find((entry: { self: boolean }) => entry.self).points).toBe(question.points);
    await info.attach(`learn-ranking-${viewport.width}`, { body: await page.screenshot(), contentType: "image/png" });
    await page.reload();
    await more(page);
    await page.getByRole("button", { name: "Rangliste", exact: true }).click();
    await expect(page.locator(".leader-row.self strong")).toHaveText(String(question.points));
    expect(failures).toEqual([]);
  });
}

test("Learning does not report saved points when the event request fails", async ({ page }) => {
  await page.goto(`/learn/${token}`);
  await page.route("**/api/events", (route) => route.request().postDataJSON()?.eventType === "answer_selected"
    ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Controlled unavailable response" }) })
    : route.continue());
  await page.getByRole("button", { name: "Quiz (Leertaste)", exact: true }).click();
  const question = demoLecture.questions.find((item) => item.level === "2.0")!;
  await page.getByRole("button", { name: question.answers.find((item) => item.correct)!.text, exact: false }).click();
  await expect(page.locator(".learn-save-status")).toContainText("Speichern nicht bestätigt");
  await page.unroute("**/api/events");
  await page.reload();
  await page.getByRole("button", { name: "Quiz (Leertaste)", exact: true }).click();
  await page.getByRole("button", { name: question.answers.find((item) => item.correct)!.text, exact: false }).click();
  await expect(page.locator(".learn-save-status")).toContainText("Antwort gespeichert");
  await page.getByRole("button", { name: "Weiterlernen", exact: true }).click();
  await more(page);
  await page.getByRole("button", { name: "Rangliste", exact: true }).click();
  await expect(page.locator(".leader-row.self strong")).toHaveText(String(question.points));
});

test("density changes real practice cadence while all four difficulty levels remain available", async ({ page }) => {
  await page.goto(`/learn/${token}`);
  await more(page);
  const density = page.getByRole("slider", { name: "Fragedichte", exact: true });
  await density.press("End");
  await expect(page.locator(".hotspots button")).toHaveCount(4);
  await closeMore(page);
  const navigation = page.getByRole("navigation", { name: "Foliennavigation" });
  const forward = page.getByRole("button", { name: "Nächste Folie", exact: true });
  const drawer = page.getByRole("region", { name: "Quizfrage", exact: true });
  await forward.click();
  await expect(navigation).toContainText("1 / 3");
  await expect(drawer).toBeVisible();
  await expect(drawer.locator(".levels button")).toHaveCount(4);
  const question = demoLecture.questions.find((item) => item.level === "2.0")!;
  await expect(drawer.locator(".question")).toHaveText(question.text);
  await drawer.getByRole("button", { name: question.answers.find((item) => item.correct)!.text, exact: false }).click();
  await expect(page.locator(".learn-save-status")).toContainText("Antwort gespeichert");
  await drawer.getByRole("button", { name: "Weiterlernen", exact: true }).click();
  await expect(navigation).toContainText("2 / 3");
  await expect(drawer).not.toBeVisible();

  await page.getByRole("button", { name: "Vorherige Folie", exact: true }).click();
  await more(page);
  await density.press("Home");
  await expect(page.locator(".hotspots button")).toHaveCount(4);
  await expect(density).toHaveAttribute("aria-valuetext", "alle 7 Folien");
  await closeMore(page);
  await forward.click();
  await expect(navigation).toContainText("2 / 3");
  await expect(drawer).not.toBeVisible();
  await forward.click();
  await expect(navigation).toContainText("3 / 3");
  await expect(drawer).not.toBeVisible();
  // Short decks still get a closing check; dismissing it must not trap Next.
  await forward.click();
  await expect(navigation).toContainText("3 / 3");
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).not.toBeVisible();
  await forward.click();
  await expect(navigation).toContainText("1 / 3");
  await expect(drawer).not.toBeVisible();
});
