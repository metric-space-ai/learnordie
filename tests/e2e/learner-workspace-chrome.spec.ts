import { expect, test, type Locator, type Page } from "@playwright/test";

const LEARN_TOKEN = "tm-kombiniert-demo";
const LEARN_URL = `/learn/${LEARN_TOKEN}`;
const LIVE_URL = `/l/${LEARN_TOKEN}`;

async function mockStudentWrites(page: Page) {
  await page.route("**/api/student/profile", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ profile: { id: "learner-workspace-e2e" } })
  }));
  await page.route("**/api/student/enrollments", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: "{}"
  }));
  await page.route("**/api/events", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: "{}"
  }));
}

async function exercisePanelDismissal(
  page: Page,
  trigger: Locator,
  panel: Locator,
  closeName: string,
  reopenTrigger?: () => Promise<void>
) {
  await trigger.click();
  await expect(panel).toBeVisible();
  await trigger.click();
  await expect(panel).toHaveCount(0);

  await trigger.click();
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);

  await reopenTrigger?.();
  await trigger.click();
  await expect(panel).toBeVisible();
  await panel.getByRole("button", { name: closeName, exact: true }).click();
  await expect(panel).toHaveCount(0);
}

test.describe("standalone learner workspace", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockStudentWrites(page);
    await page.route(`**/api/lecture/${LEARN_TOKEN}/leaderboard**`, (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ entries: [] })
    }));
    await page.goto(LEARN_URL);
    await expect(page.getByRole("group", { name: "Lernsteuerung" })).toBeVisible();
  });

  test("keeps the participation control small and the canvas on one compact control group", async ({ page }) => {
    const toolbar = page.getByRole("group", { name: "Lernsteuerung" });
    const toolbarBox = await toolbar.boundingBox();
    expect(toolbarBox?.width ?? 999).toBeLessThan(350);
    await expect(page.locator(".learn-bar, .action-stack, .slide-nav")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "Foliennavigation" })).toBeVisible();

    const participation = page.locator(".slide-engine-stage .slide-lecture-link");
    await expect(participation).toBeVisible();
    const participationBox = await participation.boundingBox();
    expect(participationBox?.x ?? 999).toBeLessThan(40);
    expect(participationBox?.y ?? 999).toBeLessThan(40);
    expect(participationBox?.width ?? 999).toBeLessThan(330);
    const stageBox = await page.locator(".slide-engine-stage").boundingBox();
    expect(stageBox?.height ?? 0).toBeGreaterThan(800);

    const more = page.locator(".learner-control-menu summary");
    await more.click();
    const density = page.getByRole("slider", { name: "Fragedichte" });
    await expect(density).toBeVisible();
    const maximumDensity = await density.getAttribute("max");
    await density.focus();
    await density.press("End");
    await expect(density).toHaveValue(maximumDensity!);
    await expect(page.locator(".hotspots .hotspot")).toHaveCount(Number(maximumDensity));
    await page.locator(".hotspots .hotspot").first().click();
    const question = page.locator(".question-drawer");
    await expect(question).toBeVisible();
    await page.locator(".hotspots .hotspot").first().click();
    await expect(question).not.toBeVisible();
    await page.locator(".hotspots .hotspot").first().click();
    await expect(question).toBeVisible();
    await more.click();
    const levels = question.locator(".levels button");
    await expect(levels).toHaveCount(4);
    await levels.filter({ hasText: "1.0" }).click();
    await expect(question).toHaveAttribute("data-level", "1.0");
  });

  test("chat, leaderboard, and feedback panels toggle, escape, and close explicitly", async ({ page }) => {
    const more = page.locator(".learner-control-menu summary");
    await more.click();

    const actions = [
      {
        id: "learner-chat-panel",
        closeName: "Chat schließen"
      },
      {
        id: "learner-leaderboard-panel",
        closeName: "Rangliste schließen"
      },
      {
        id: "learner-evaluation-panel",
        closeName: "Evaluation schließen"
      }
    ];

    for (const action of actions) {
      const trigger = page.locator(`.learner-control-menu-panel [aria-controls="${action.id}"]`);
      await expect(trigger, `Required ${action.id} trigger must exist`).toHaveCount(1);
      await exercisePanelDismissal(
        page,
        trigger,
        page.locator(`#${action.id}`),
        action.closeName,
        async () => more.click()
      );
    }
  });
});

test("live learner follows the presenter, and pseudonym editing is opt-in", async ({ page }) => {
  let revision = 1;
  let slideIndex = 0;
  await page.setViewportSize({ width: 390, height: 844 });
  await mockStudentWrites(page);
  await page.route("**/api/student/claim*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ claim: { displayName: "Generated Learner" } })
  }));
  await page.route(`**/api/lecture/${LEARN_TOKEN}/live*`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      sessionId: "learner-workspace-session",
      revision,
      status: "active",
      slideIndex,
      showIntro: false,
      serverNow: Date.now(),
      round: null,
      receipt: { level: "2.0", selected: "A", correct: true, points: 1, explanation: "Test answer." },
      leaderboard: []
    })
  }));

  await page.goto(LIVE_URL);
  const toolbar = page.getByRole("group", { name: "Live-Steuerung" });
  await expect(toolbar).toBeVisible();
  await expect(page.locator("main")).toHaveAttribute("data-live-status", "active");
  const firstSlide = await page.locator("[data-slide-id]").first().getAttribute("data-slide-id");
  expect(firstSlide).toBeTruthy();
  slideIndex = 1;
  revision = 2;
  await expect(page.locator("[data-slide-id]").first()).not.toHaveAttribute("data-slide-id", firstSlide!);
  await expect(page.locator(".slide-nav")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Vorherige Folie", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Nächste Folie", exact: true })).toHaveCount(0);
  await expect(page.locator("#live-identity-panel")).toHaveCount(0);
  await expect(page.getByLabel("Eigenes Pseudonym")).toHaveCount(0);

  const pseudonymTrigger = toolbar.getByRole("button", { name: "Pseudonym", exact: true });
  await expect(pseudonymTrigger).toBeVisible();
  await pseudonymTrigger.click();
  await expect(page.getByLabel("Eigenes Pseudonym")).toBeVisible();
  await expect(page.getByLabel("Eigenes Pseudonym")).toHaveValue("Generated Learner");
  await pseudonymTrigger.click();
  await expect(page.locator("#live-identity-panel")).toHaveCount(0);

  await pseudonymTrigger.click();
  await expect(page.locator("#live-identity-panel")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#live-identity-panel")).toHaveCount(0);

  await pseudonymTrigger.click();
  await expect(page.locator("#live-identity-panel")).toBeVisible();
  await page.getByRole("button", { name: "Pseudonym schließen", exact: true }).click();
  await expect(page.locator("#live-identity-panel")).toHaveCount(0);
});
