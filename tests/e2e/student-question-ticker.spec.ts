import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import postgres from "postgres";
import type { Lecture, QuestionVariant } from "../../src/lib/types";
import type { LiveSessionView } from "../../src/lib/live-session";

// The provider fixture exercises the actual Responses adapter and strict draft
// contract; it is deliberately not evidence of external MiniMax availability.
test("student question becomes a reviewed live round while presenter and three students continue", async ({ browser }) => {
  test.skip(process.env.E2E_AI_PROVIDER !== "learnordie-responses", "Requires the focused Responses-provider acceptance run.");
  test.setTimeout(140_000);
  const databaseUrl = process.env.E2E_DATABASE_URL;
  if (!databaseUrl || !new URL(databaseUrl).pathname.includes("e2e")) throw new Error("An isolated E2E database is required.");
  const sql = postgres(databaseUrl, { max: 2, prepare: false });
  const contexts: BrowserContext[] = [];
  const errors: string[] = [];
  const open = async () => {
    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    page.on("response", response => { if (response.status() >= 500) errors.push(`${response.status()} ${new URL(response.url()).pathname}`); });
    return page;
  };
  try {
    const teacher = await open();
    await teacher.goto("/lecturer/login");
    await teacher.getByLabel("E-Mail", { exact: true }).fill(`ticker-ui-${Date.now()}-${test.info().retry}@example.test`);
    await teacher.getByRole("button", { name: "Code senden", exact: true }).click();
    const loginLink = teacher.getByRole("link", { name: "Direkt zum Dozentenbereich" });
    await expect(loginLink).toBeVisible();
    await teacher.goto((await loginLink.getAttribute("href"))!);
    const csrf = await teacher.locator("[data-csrf-token]").first().getAttribute("data-csrf-token");
    expect(csrf).toBeTruthy();
    const created = await teacher.request.post("/api/lectures", {
      headers: { "x-learnbuddy-csrf": csrf! },
      data: { title: `Ticker Classroom ${Date.now()}`, seriesTitle: `Ticker ${Date.now()}`, liveAt: "2026-09-12T10:00:00Z", examDate: "2026-12-01" }
    });
    expect(created.status()).toBe(201);
    const { lecture } = await created.json() as { lecture: Lecture };
    await teacher.goto(`/lecturer/live/${lecture.publicToken}`);
    await teacher.getByRole("button", { name: "Präsentation starten", exact: true }).click();
    const students = await Promise.all([open(), open(), open()]);
    await students[2].setViewportSize({ width: 390, height: 844 });
    await Promise.all(students.map(student => student.goto(`/l/${lecture.publicToken}`)));
    const slide = (page: Page) => page.locator("[data-slide-id]").first();
    for (const student of students) await expect(slide(student)).toHaveAttribute("data-slide-id", lecture.slides[0].id);
    const ticker = teacher.getByRole("complementary", { name: "Eingehende Studierendenfragen" });
    const toggle = ticker.locator(".student-question-ticker__toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(teacher.locator(".presentation-control-panel")).toBeHidden();
    const questionText = "Wie beeinflusst die Viskosität den Schmierfilm im Stribeck-Bereich?";
    await students[0].getByRole("button", { name: "Frage stellen", exact: true }).click();
    await students[0].getByLabel("Deine Frage", { exact: true }).fill(questionText);
    const submitted = students[0].waitForResponse(response => response.request().method() === "POST" && response.url().endsWith(`/api/lecture/${lecture.publicToken}/chat-questions`));
    await students[0].getByRole("button", { name: "Senden", exact: true }).click();
    const accepted = await submitted;
    expect(accepted.status()).toBe(200);
    const submission = await accepted.json() as { accepted: boolean; chatQuestion: { id: string } };
    expect(submission.accepted).toBe(true);
    await students[0].getByRole("button", { name: "Frage an Dozierende schließen", exact: true }).click();
    await expect(toggle).toContainText("1", { timeout: 30_000 });
    // Arrival never opens a teacher panel or broadcasts a question automatically.
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    for (const student of students) await expect(student.getByLabel("Quizfrage", { exact: true })).toHaveCount(0);
    await toggle.click();
    await expect(ticker).toContainText(questionText);
    await expect(ticker.getByText("Entwurf prüfen", { exact: false })).toBeVisible({ timeout: 40_000 });
    await ticker.locator(".student-question-ticker__draft-summary").click();
    await expect(ticker.locator(".student-question-ticker__variant")).toHaveCount(4);
    for (const variant of await ticker.locator(".student-question-ticker__variant").all()) {
      await expect(variant.locator("li")).toHaveCount(4);
      await expect(variant.locator('[data-correct="true"]')).toHaveCount(1);
    }
    await teacher.keyboard.press("Escape");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(toggle).toBeFocused();
    await toggle.click();
    await ticker.getByRole("button", { name: "Live stellen · 60 s", exact: true }).click();
    await expect(ticker).toContainText("Veröffentlicht");
    await toggle.click();
    await teacher.locator("main").click({ position: { x: 450, y: 35 } });
    await teacher.keyboard.press("ArrowRight");
    for (const student of students) {
      await expect(slide(student)).toHaveAttribute("data-slide-id", lecture.slides[1].id);
      await expect(student.getByLabel("Quizfrage", { exact: true })).toBeVisible();
      await expect(student.getByRole("group", { name: "Niveau", exact: true }).getByRole("button")).toHaveCount(4);
    }
    await expect(teacher.getByLabel("Quizfrage", { exact: true })).toHaveCount(0);
    await expect(teacher.getByRole("timer", { name: "Fragerunde läuft" })).toBeVisible();
    const state = async () => await (await teacher.request.get(`/api/lecture/${lecture.publicToken}/live?leaderboard=1`)).json() as LiveSessionView;
    const opened = await state();
    expect(opened.round).not.toBeNull();
    const round = opened.round!;
    expect(round.expiresAt - opened.serverNow).toBeGreaterThan(40_000);
    expect(round.expiresAt - opened.serverNow).toBeLessThanOrEqual(60_000);
    const [review] = await sql`select variants_json from question_review_items where source_student_question_id = ${submission.chatQuestion.id}`;
    const variants = review.variants_json as QuestionVariant[];
    for (let index = 0; index < students.length; index++) {
      const variant = variants[index];
      const student = students[index];
      await student.getByRole("button", { name: variant.level, exact: true }).click();
      const key = variant.answers.find(answer => answer.correct)!.key;
      await student.locator(".answers .answer").filter({ has: student.locator(".letter", { hasText: key }) }).click();
      await expect(student.locator(".question-feedback")).toContainText("Richtig");
    }
    await students[0].reload();
    await expect(students[0].locator(".question-feedback")).toContainText("Richtig");
    await expect(students[0].locator(".answers .answer").first()).toBeDisabled();
    const [receipts] = await sql`select count(*)::int as count from live_answers where round_id = ${round.id}`;
    expect(receipts.count).toBe(3);
    await teacher.keyboard.press("ArrowLeft");
    for (const student of students) await expect(slide(student)).toHaveAttribute("data-slide-id", lecture.slides[0].id);
    // Real 60-second deadline; no test-clock override or premature close command.
    for (const student of students) await expect(student.getByLabel("Quizfrage", { exact: true })).toHaveCount(0, { timeout: 65_000 });
    await expect.poll(async () => (await state()).round).toBeNull();
    await students[0].getByRole("button", { name: "Rangliste", exact: true }).click();
    await expect(students[0].locator(".leader-row")).toHaveCount(3);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
    await sql.end();
  }
});
