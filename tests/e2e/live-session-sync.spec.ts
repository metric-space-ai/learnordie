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
    await teacher.getByRole("button", { name: "Vorbereitete Frage", exact: true }).click();
    for (const page of [first, second]) await expect(page.getByLabel("Quizfrage", { exact: true })).toBeVisible();
    await expect(teacher.getByLabel("Quizfrage", { exact: true })).toHaveCount(0);
    await expect(teacher.getByRole("timer", { name: "Fragerunde läuft" })).toBeVisible();
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
    await teacher.getByRole("button", { name: "Vorbereitete Frage", exact: true }).click();
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
    // An ended session must offer an obvious next action on the QR slide,
    // without requiring the lecturer to discover the collapsed tools menu.
    const restart = teacher.getByRole("region", { name: "Vorlesung beitreten", exact: true }).getByRole("button", { name: "Neue Live-Sitzung starten", exact: true });
    await expect(restart).toBeVisible();
    await restart.click();
    await expect(first.locator(".slide-nav .slide-count")).toHaveText("Beitreten");
    expect((await state()).sessionId).not.toBe(initial.sessionId);
    expect(problems).toEqual([]);
    await test.info().attach("live-session-evidence", { body: JSON.stringify({ lecture: lecture.publicToken, roundId, participants: 3, duplicateSafe: true, sharedExpiry: true, reconnect: true, endAndRestart: true }), contentType: "application/json" });
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await sql.end();
  }
});

test("Space generates an asynchronous 60-second round while the lecturer keeps presenting", async ({ browser }) => {
  test.setTimeout(120_000);
  const contexts: BrowserContext[] = [];
  const errors: string[] = [];
  const open = async () => {
    const context = await browser.newContext(); contexts.push(context);
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    return page;
  };
  let releaseGeneration = () => {};
  try {
    const teacher = await open();
    const { lecture, csrf } = await fixture(teacher);
    const api = `/api/lecture/${lecture.publicToken}/live`;
    const command = `/api/lectures/${lecture.id}/live-session`;
    const state = async () => await (await teacher.request.get(api)).json() as LiveSessionView;
    const students = await Promise.all([open(), open(), open()]);
    await students[2].setViewportSize({ width: 390, height: 844 });
    await Promise.all(students.map((page) => page.goto(`/l/${lecture.publicToken}`)));
    await teacher.goto(`/lecturer/live/${lecture.publicToken}`);
    await teacher.getByRole("button", { name: "Präsentation starten", exact: true }).click();
    // A failed provider call must be visible without opening an interrupting
    // modal, and the same shortcut must permit a deliberate retry.
    const generationPath = `**/api/lectures/${lecture.id}/live-questions`;
    await teacher.route(generationPath, (route) => route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ error: "Fragengenerator vorübergehend nicht erreichbar." }) }));
    await teacher.locator("body").click({ position: { x: 8, y: 100 } });
    await teacher.keyboard.press("Space");
    await expect(teacher.locator(".presenter-round-toast")).toContainText("vorübergehend nicht erreichbar");
    expect((await state()).round).toBeNull();
    await teacher.getByLabel("Präsentationssteuerung", { exact: true }).click();
    await expect(teacher.locator(".presentation-control-panel .form-error")).toContainText("vorübergehend nicht erreichbar");
    await teacher.getByLabel("Präsentationssteuerung", { exact: true }).click();
    await teacher.locator("body").click({ position: { x: 8, y: 100 } });
    await teacher.unroute(generationPath);

    // Hold the actual route response, not fake question state, to exercise
    // navigation while the real server/provider/DB pipeline is in flight.
    let requests = 0;
    let family: Lecture["questions"] = [];
    const held = new Promise<void>((resolve) => { releaseGeneration = resolve; });
    await teacher.route(generationPath, async (route) => {
      requests++;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      family = (await response.json()).family;
      expect(family).toHaveLength(4);
      expect(new Set(family.map((question) => question.familyId)).size).toBe(1);
      await held;
      await route.fulfill({ response });
    });
    await teacher.keyboard.press("Space");
    await expect(teacher.getByText("Frage wird erstellt …", { exact: true })).toBeVisible();
    await teacher.keyboard.press("Space");
    await teacher.keyboard.press("ArrowRight");
    await expect(teacher.locator("[data-slide-id]").first()).toHaveAttribute("data-slide-id", lecture.slides[1].id);
    releaseGeneration();
    await expect(teacher.getByRole("timer", { name: "Fragerunde läuft" })).toBeVisible({ timeout: 20_000 });
    expect(requests).toBe(1);
    const started = await state();
    expect(started.round).not.toBeNull();
    expect(started.round!.expiresAt - started.serverNow).toBeGreaterThan(57_000);
    expect(started.round!.expiresAt - started.serverNow).toBeLessThanOrEqual(60_000);
    expect(family.every((question) => question.slideId === lecture.slides[0].id)).toBe(true);
    await expect(teacher.getByLabel("Quizfrage", { exact: true })).toHaveCount(0);
    await expect(teacher.locator("header:visible, footer:visible")).toHaveCount(0);
    await expect(teacher.locator(".slide-engine-stage")).toHaveCSS("transform", "none");
    const stageBefore = await teacher.locator(".slide-engine-stage").boundingBox();
    for (const page of students) await expect(page.getByLabel("Quizfrage", { exact: true })).toHaveAttribute("data-round-id", started.round!.id);

    // A second trigger cannot replace a round or extend students' deadline.
    await teacher.keyboard.press("Space");
    const refused = await teacher.request.post(command, { headers: { "x-learnbuddy-csrf": csrf }, data: { action: "fire", revision: started.revision, familyIndex: 0, durationSeconds: 60 } });
    expect(refused.status()).toBe(409);
    await teacher.keyboard.press("ArrowRight");
    for (const page of [teacher, ...students]) await expect(page.locator("[data-slide-id]").first()).toHaveAttribute("data-slide-id", lecture.slides[2].id);
    expect((await state()).round!.expiresAt).toBe(started.round!.expiresAt);
    expect(await teacher.locator(".slide-engine-stage").boundingBox()).toEqual(stageBefore);
    const levels = ["4.0", "2.0", "1.0"] as const;
    const answer = async (index: number) => {
      const page = students[index];
      const question = family.find((item) => item.level === levels[index])!;
      await page.getByRole("group", { name: "Niveau" }).getByRole("button", { name: levels[index], exact: true }).click();
      const key = question.answers.find((option) => option.correct)!.key;
      await page.locator(".answers .answer").filter({ has: page.locator(".letter", { hasText: key }) }).click();
      await expect(page.locator(".question-feedback")).toContainText(`Richtig · ${question.points} Punkte`);
    };
    await Promise.all([answer(0), answer(1)]);
    await expect(teacher.locator(".presenter-round-toast")).toHaveText("", { timeout: 7000 });
    await test.info().attach("presenter-uninterrupted-round", { body: await teacher.screenshot(), contentType: "image/png" });
    // Real elapsed time and PostgreSQL expiry: no fast-forwarded browser clock,
    // no shortened fixture duration. The third student answers near the end.
    await expect.poll(async () => {
      const current = await state();
      return started.round!.expiresAt - current.serverNow;
    }, { timeout: 65_000, intervals: [1000] }).toBeLessThan(8000);
    await answer(2);
    for (const page of students) await expect(page.getByLabel("Quizfrage", { exact: true })).toHaveCount(0, { timeout: 12_000 });
    await expect(teacher.locator(".presenter-round-toast")).toHaveText("Fragerunde beendet · Rangliste aktualisiert.");
    await expect(teacher.getByRole("timer", { name: "Fragerunde läuft" })).toHaveCount(0);
    const rejected = await students[2].request.post(api, { data: { sessionId: started.sessionId, roundId: started.round!.id, level: "1.0", selected: "A" } });
    expect(rejected.status()).toBe(409);
    for (const [index, page] of students.entries()) {
      await page.getByRole("button", { name: "Rangliste", exact: true }).click();
      await expect(page.locator(".leader-row")).toHaveCount(3);
      await expect(page.locator(".leader-row.self strong")).toHaveText(String(family.find((item) => item.level === levels[index])!.points));
    }
    await teacher.keyboard.press("ArrowLeft");
    await expect(teacher.locator("[data-slide-id]").first()).toHaveAttribute("data-slide-id", lecture.slides[1].id);
    expect(errors).toEqual([]);
    await teacher.getByLabel("Präsentationssteuerung", { exact: true }).click();
    await teacher.getByRole("button", { name: "Beenden", exact: true }).click();
    await expect(teacher).toHaveURL(/\/lecturer$/);
  } finally {
    releaseGeneration();
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test("Concurrent generation returns exactly the family created by each request", async ({ page }) => {
  const { lecture, csrf } = await fixture(page);
  const responses = await Promise.all([0, 1].map((index) => page.request.post(`/api/lectures/${lecture.id}/live-questions`, {
    headers: { "x-learnbuddy-csrf": csrf },
    data: { slideId: lecture.slides[index].id, allowSlideContext: true }
  })));
  const families: Lecture["questions"][] = [];
  for (const [index, response] of responses.entries()) {
    expect(response.status()).toBe(200);
    const { family } = await response.json();
    expect(family).toHaveLength(4);
    expect(new Set(family.map((question: Lecture["questions"][number]) => question.familyId)).size).toBe(1);
    expect(family.every((question: Lecture["questions"][number]) => question.slideId === lecture.slides[index].id)).toBe(true);
    families.push(family);
  }
  expect(families[0][0].familyId).not.toBe(families[1][0].familyId);
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
    const roundStarted = owner.waitForResponse((response) => new URL(response.url()).pathname === `/api/lectures/${lecture.id}/live-session`
      && response.request().method() === "POST" && response.request().postDataJSON()?.action === "fire");
    await owner.getByRole("button", { name: "Vorbereitete Frage", exact: true }).click();
    const roundResponse = await roundStarted;
    expect(roundResponse.status()).toBe(200);
    const state = await roundResponse.json() as LiveSessionView;
    expect(state.round).not.toBeNull();
    const round = state.round!;
    let release!: () => void;
    let locked!: () => void;
    const acquired = new Promise<void>((resolve) => { locked = resolve; });
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const lock = sql.begin(async (tx) => { await tx`select lecture_id from live_sessions where lecture_id = ${lecture.id} for update`; locked(); await hold; });
    let pendingAnswer: ReturnType<typeof student.request.post> | undefined;
    try {
      // A failed acquisition must propagate instead of leaving the hold promise
      // and database shutdown waiting forever. Release on every failure path.
      await Promise.race([acquired, lock]);
      pendingAnswer = student.request.post(`/api/lecture/${lecture.publicToken}/live`, { data: { sessionId: state.sessionId, roundId: round.id, level: "2.0", selected: "A" } });
      // Real database wall time, not a mocked browser clock or altered production state.
      await expect.poll(async () => Number((await sql`select extract(epoch from clock_timestamp())*1000 as now`)[0].now), { timeout: 10000 }).toBeGreaterThan(round.expiresAt + 100);
    } finally { release(); await lock; }
    expect(pendingAnswer).toBeDefined();
    expect((await pendingAnswer!).status()).toBe(409);
    expect(Number((await sql`select count(*) from live_answers where round_id = ${round.id}`)[0].count)).toBe(0);
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
