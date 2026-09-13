import { expect, test, type Page, type BrowserContext } from "@playwright/test";
import postgres from "postgres";
import type { Lecture } from "../../src/lib/types";
import type { LiveSessionView } from "../../src/lib/live-session";

async function login(page: Page, email: string) {
  await page.goto("/lecturer/login");
  await page.getByLabel("E-Mail", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Code senden", exact: true }).click();
  const link = page.getByRole("link", { name: "Direkt zum Dozentenbereich" });
  await expect(link).toBeVisible();
  await page.goto((await link.getAttribute("href"))!);
  await expect(page).toHaveURL(/\/lecturer$/);
  const csrf = await page.locator("[data-csrf-token]").first().getAttribute("data-csrf-token");
  expect(csrf).toBeTruthy();
  return csrf!;
}

async function fixture(page: Page) {
  const nonce = `${Date.now()}-${test.info().retry}`;
  const csrf = await login(page, `sync-${nonce}@example.test`);
  const response = await page.request.post("/api/lectures", { headers: { "x-learnbuddy-csrf": csrf }, data: {
    title: `Live Sync ${nonce}`, seriesTitle: `Sync Classroom ${nonce}`, liveAt: "2026-09-12T10:00:00Z", examDate: "2026-12-01"
  } });
  expect(response.status()).toBe(201);
  const { lecture } = await response.json() as { lecture: Lecture };
  expect(lecture.slides.length).toBeGreaterThan(1);
  return { lecture, csrf };
}

function database() {
  const url = process.env.E2E_DATABASE_URL ?? "postgres://michaelwelsch@127.0.0.1:55432/learnbuddy_e2e_smoke";
  if (!new URL(url).pathname.includes("e2e")) throw new Error("Live sync DB assertions require an isolated E2E database.");
  return postgres(url, { max: 2, prepare: false });
}

test("Live classroom: presenter, three students, late join, receipts, scoreboard, expiry, reconnect and end", async ({ browser }) => {
  test.setTimeout(120_000);
  const contexts: BrowserContext[] = [];
  const problems: string[] = [];
  const open = async () => {
    const context = await browser.newContext(); contexts.push(context);
    const page = await context.newPage();
    page.on("pageerror", (error) => problems.push(error.message));
    page.on("console", (message) => { if (message.type() === "error" && !message.text().includes("Failed to load resource")) problems.push(message.text()); });
    page.on("response", (response) => { if (response.status() >= 500) problems.push(`${response.status()} ${response.url()}`); });
    return page;
  };
  const sql = database();
  try {
    const teacher = await open();
    const { lecture, csrf } = await fixture(teacher);
    const liveUrl = `/l/${lecture.publicToken}`;
    const apiUrl = `/api/lecture/${lecture.publicToken}/live`;
    const commandUrl = `/api/lectures/${lecture.id}/live-session`;
    const state = async (page = teacher) => (await (await page.request.get(apiUrl)).json()) as LiveSessionView;

    const first = await open(); const second = await open();
    await Promise.all([first.goto(liveUrl), second.goto(liveUrl)]);
    for (const page of [first, second]) {
      await expect(page.getByLabel("Vorlesung beitreten", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Teilnehmen", exact: true })).toHaveCount(0);
      await expect(page.getByLabel("Quizfrage", { exact: true })).toHaveCount(0);
    }
    await teacher.goto(`/lecturer/live/${lecture.publicToken}`);
    await expect(teacher.locator("main")).toHaveAttribute("data-live-status", "active");
    await expect(teacher.locator(".slide-lecture-link")).toHaveAttribute("href", new RegExp(`/l/${lecture.publicToken}$`));
    await teacher.getByRole("button", { name: "Präsentation starten", exact: true }).click();
    for (const page of [teacher, first, second]) await expect(page.locator("[data-slide-id]").first()).toHaveAttribute("data-slide-id", lecture.slides[0].id);
    await first.keyboard.press("ArrowRight");
    await expect(first.locator(".slide-nav .slide-count")).toHaveText(`1 / ${lecture.slides.length}`);
    await teacher.getByLabel("Präsentationssteuerung", { exact: true }).click();
    await teacher.getByRole("button", { name: "Nächste Folie", exact: true }).click();
    for (const page of [first, second]) await expect(page.locator("[data-slide-id]").first()).toHaveAttribute("data-slide-id", lecture.slides[1].id);
    await teacher.getByRole("button", { name: "Vorherige Folie", exact: true }).click();
    await teacher.getByRole("button", { name: "Vorherige Folie", exact: true }).click();
    for (const page of [first, second]) await expect(page.locator(".slide-nav .slide-count")).toHaveText("Beitreten");
    await teacher.getByRole("button", { name: "Präsentation starten", exact: true }).click();
    await teacher.getByRole("button", { name: "Quiz (Leertaste)", exact: true }).click();
    for (const page of [teacher, first, second]) await expect(page.getByLabel("Quizfrage", { exact: true })).toBeVisible();
    const initial = await state();
    expect(initial.round).not.toBeNull();
    const roundId = initial.round!.id;
    for (const question of initial.round!.questions) {
      expect(question).not.toHaveProperty("explanation");
      expect(question.answers.every((option) => !("correct" in option))).toBe(true);
    }
    const third = await open();
    await third.setViewportSize({ width: 390, height: 844 });
    await third.goto(liveUrl);
    await expect(third.getByLabel("Quizfrage", { exact: true })).toBeVisible();
    const drawerBox = await third.getByLabel("Quizfrage", { exact: true }).boundingBox();
    expect(drawerBox!.x).toBeGreaterThanOrEqual(0);
    expect(drawerBox!.x + drawerBox!.width).toBeLessThanOrEqual(390);
    await third.keyboard.press("Tab");
    await expect(third.locator(".levels button").first()).toBeFocused();
    expect((await state(third)).round!.expiresAt).toBe(initial.round!.expiresAt);
    await third.reload();
    await expect(third.getByLabel("Quizfrage", { exact: true })).toBeVisible();
    expect((await state(third)).round!.expiresAt).toBe(initial.round!.expiresAt);

    // The real server owns correctness. Read fixture content only on the lecturer API.
    const chosen = lecture.questions.find((question) => question.level === "2.0")!;
    const correctKey = chosen.answers.find((answer) => answer.correct)!.key;
    await Promise.all([first, second, third].map((page) => page.locator(".answers .answer").filter({ has: page.locator(".letter", { hasText: correctKey }) }).click()));
    for (const page of [first, second, third]) await expect(page.locator(".question-feedback")).toContainText("Richtig");
    await first.reload();
    await expect(first.locator(".question-feedback")).toContainText("Richtig");
    await expect(first.locator(".answers .answer").first()).toBeDisabled();
    const duplicate = await Promise.all([1, 2].map(() => first.request.post(apiUrl, { data: { sessionId: initial.sessionId, roundId, level: "1.0", selected: "B" } })));
    expect(duplicate.map((response) => response.status())).toEqual([200, 200]);
    const counts = await sql`select count(*)::int as count from live_answers where round_id = ${roundId}`;
    expect(counts[0].count).toBe(3);
    const events = await sql`select count(*)::int as count from analytics_events where event_payload->>'liveRoundId' = ${roundId}`;
    expect(events[0].count).toBe(3);
    expect((await state(teacher)).receipt).toBeNull();

    await teacher.getByRole("button", { name: "Frage schließen", exact: true }).click();
    for (const page of [first, second, third]) await expect(page.getByLabel("Quizfrage", { exact: true })).toHaveCount(0);
    await first.getByLabel("Eigenes Pseudonym", { exact: true }).fill(`Sync Alias ${Date.now()}`);
    await first.getByRole("button", { name: "Sichern", exact: true }).click();
    await expect(first.getByLabel("Pseudonym sichern", { exact: true })).toContainText("Pseudonym gesichert");
    // Body-level utility controls must not intercept panel actions, including
    // when the slide surface establishes a separate stacking context.
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      await first.setViewportSize(viewport);
      await first.getByRole("button", { name: "Rangliste", exact: true }).click();
      await expect(first.getByRole("complementary", { name: "Rangliste", exact: true })).toBeVisible();
      await expect(first.locator(".app-theme-control")).toBeHidden();
      await first.getByRole("button", { name: "Rangliste schließen", exact: true }).click();
      await expect(first.getByRole("complementary", { name: "Rangliste", exact: true })).toHaveCount(0);
      await expect(first.locator(".app-theme-control")).toBeVisible();
    }
    await first.setViewportSize({ width: 1280, height: 900 });
    await teacher.getByRole("button", { name: "Rangliste", exact: true }).click();
    await expect(teacher.locator(".leader-row")).toHaveCount(3);
    await expect(teacher.locator(".leader-row").filter({ hasText: "Sync Alias" })).toHaveCount(1);

    // Keep the scoreboard open during the next round: it must update without reopening.
    await teacher.getByLabel("Fragezeit", { exact: true }).selectOption("15");
    await teacher.getByRole("button", { name: "Quiz (Leertaste)", exact: true }).click();
    await expect(second.getByLabel("Quizfrage", { exact: true })).toBeVisible();
    await second.locator(".answers .answer").filter({ has: second.locator(".letter", { hasText: correctKey }) }).click();
    await expect(teacher.locator(".leader-row strong").first()).toHaveText(String(chosen.points * 2));
    const secondRound = await state();
    await third.context().setOffline(true);
    await expect(third.getByLabel("Quizfrage", { exact: true })).toHaveCount(0, { timeout: 18000 });
    await third.context().setOffline(false);
    await expect(third.locator("main")).toHaveAttribute("data-live-status", "active");
    for (const page of [first, second, third, teacher]) await expect(page.getByLabel("Quizfrage", { exact: true })).toHaveCount(0, { timeout: 18000 });
    const expired = await third.request.post(apiUrl, { data: { sessionId: secondRound.sessionId, roundId: secondRound.round!.id, level: "2.0", selected: correctKey } });
    expect(expired.status()).toBe(409);
    await third.reload();
    await expect(third.getByLabel("Quizfrage", { exact: true })).toHaveCount(0);

    const csrfRejected = await teacher.request.post(commandUrl, { data: { action: "end", revision: (await state()).revision } });
    expect(csrfRejected.status()).toBe(403);
    const studentRejected = await third.request.post(commandUrl, { data: { action: "end", revision: (await state()).revision } });
    expect(studentRejected.status()).toBe(401);
    const stale = await teacher.request.post(commandUrl, { headers: { "x-learnbuddy-csrf": csrf }, data: { action: "end", revision: 0 } });
    expect(stale.status()).toBe(409);
    await teacher.getByRole("button", { name: "Rangliste schließen", exact: true }).click();
    await teacher.getByRole("button", { name: "Beenden", exact: true }).click();
    await expect(teacher).toHaveURL(/\/lecturer$/);
    for (const page of [first, second, third]) await expect(page.getByText("Die Live-Sitzung ist beendet.", { exact: false })).toBeVisible();
    await teacher.goto(`/lecturer/live/${lecture.publicToken}`);
    await expect(teacher.locator("main")).toHaveAttribute("data-live-status", "ended");
    await teacher.getByRole("button", { name: "Neue Live-Sitzung starten", exact: true }).click();
    await expect(first.locator(".slide-nav .slide-count")).toHaveText("Beitreten");
    expect((await state()).sessionId).not.toBe(initial.sessionId);
    expect(problems).toEqual([]);
    await test.info().attach("live-session-evidence", { body: JSON.stringify({ lecture: lecture.publicToken, roundId, participants: 3, duplicateSafe: true, sharedExpiry: true, reconnect: true, endAndRestart: true }), contentType: "application/json" });
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await sql.end();
  }
});

test("Private presenter route rejects another lecturer; DB lock cannot extend answer deadline", async ({ browser }) => {
  test.setTimeout(60000);
  const ownerContext = await browser.newContext(); const otherContext = await browser.newContext(); const studentContext = await browser.newContext();
  const sql = database();
  try {
    const owner = await ownerContext.newPage(); const other = await otherContext.newPage(); const student = await studentContext.newPage();
    const { lecture, csrf } = await fixture(owner);
    const otherCsrf = await login(other, `sync-other-${Date.now()}@example.test`);
    const forbiddenPage = await other.goto(`/lecturer/live/${lecture.publicToken}`);
    expect(forbiddenPage?.status()).toBe(404);
    await expect(other.locator("[data-slide-engine]")).toHaveCount(0);
    const denied = await other.request.post(`/api/lectures/${lecture.id}/live-session`, { headers: { "x-learnbuddy-csrf": otherCsrf }, data: { action: "start", revision: 0 } });
    expect(denied.status()).toBe(404);
    await owner.goto(`/lecturer/live/${lecture.publicToken}`);
    await expect(owner.locator("main")).toHaveAttribute("data-live-status", "active");
    await owner.getByRole("button", { name: "Präsentation starten", exact: true }).click();
    await student.goto(`/l/${lecture.publicToken}`);
    await expect.poll(async () => (await studentContext.cookies()).some((cookie) => cookie.name === "lb_student_key")).toBe(true);
    await owner.getByLabel("Präsentationssteuerung", { exact: true }).click();
    await owner.getByLabel("Fragezeit", { exact: true }).selectOption("5");
    await owner.getByRole("button", { name: "Quiz (Leertaste)", exact: true }).click();
    const state = await (await owner.request.get(`/api/lecture/${lecture.publicToken}/live`)).json() as LiveSessionView;
    let release!: () => void;
    let locked!: () => void;
    const acquired = new Promise<void>((resolve) => { locked = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const lock = sql.begin(async (tx) => { await tx`select lecture_id from live_sessions where lecture_id = ${lecture.id} for update`; locked(); await hold; });
    await acquired;
    const pendingAnswer = student.request.post(`/api/lecture/${lecture.publicToken}/live`, { data: { sessionId: state.sessionId, roundId: state.round!.id, level: "2.0", selected: "A" } });
    try {
      // Real database wall time, not a mocked browser clock or altered production state.
      await expect.poll(async () => Number((await sql`select extract(epoch from clock_timestamp())*1000 as now`)[0].now), { timeout: 10000 }).toBeGreaterThan(state.round!.expiresAt + 100);
    } finally { release(); await lock; }
    expect((await pendingAnswer).status()).toBe(409);
    expect(Number((await sql`select count(*) from live_answers where round_id = ${state.round!.id}`)[0].count)).toBe(0);
    const fired = await owner.request.post(`/api/lectures/${lecture.id}/live-session`, { headers: { "x-learnbuddy-csrf": csrf }, data: { action: "fire", familyIndex: 0, durationSeconds: 60, revision: state.revision } });
    expect(fired.status()).toBe(200);
    const fresh = await fired.json() as LiveSessionView;
    // Closing and answering concurrently must serialize, never FK-lock deadlock.
    const [closed, racedAnswer] = await Promise.all([
      owner.request.post(`/api/lectures/${lecture.id}/live-session`, { headers: { "x-learnbuddy-csrf": csrf }, data: { action: "close", revision: fresh.revision } }),
      student.request.post(`/api/lecture/${lecture.publicToken}/live`, { data: { sessionId: fresh.sessionId, roundId: fresh.round!.id, level: "2.0", selected: "A" } })
    ]);
    expect(closed.status()).toBe(200);
    expect([200, 409]).toContain(racedAnswer.status());
    const end = await owner.request.post(`/api/lectures/${lecture.id}/live-session`, { headers: { "x-learnbuddy-csrf": csrf }, data: { action: "end", revision: (await closed.json()).revision } });
    expect(end.status()).toBe(200);
  } finally { await Promise.all([ownerContext.close(), otherContext.close(), studentContext.close()]); await sql.end(); }
});
