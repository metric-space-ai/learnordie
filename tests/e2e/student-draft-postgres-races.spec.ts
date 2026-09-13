import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import postgres from "postgres";

import { seriesIdForLecture } from "../../src/lib/series";
import type { Lecture, QuestionVariant } from "../../src/lib/types";
import { StudentQuestionTickerItem, type TickerQuestion } from "../../src/components/StudentQuestionTicker";
import { commandLiveSession } from "../../src/server/live-session-repository";
import { getLectureRepository } from "../../src/server/repository";
import { getStudentRepository } from "../../src/server/student-repository";

const DEFAULT_DATABASE_URL = "postgres://michaelwelsch@127.0.0.1:55432/learnbuddy_e2e_smoke";

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

async function lectureFixture(page: Page) {
  const nonce = `${Date.now()}-${test.info().retry}`;
  const csrf = await login(page, `draft-race-${nonce}@example.test`);
  const response = await page.request.post("/api/lectures", {
    headers: { "x-learnbuddy-csrf": csrf },
    data: {
      title: `Draft Race ${nonce}`,
      seriesTitle: `Draft Race Series ${nonce}`,
      liveAt: "2026-09-12T10:00:00Z",
      examDate: "2026-12-01"
    }
  });
  expect(response.status()).toBe(201);
  const { lecture } = await response.json() as { lecture: Lecture };
  expect(lecture.slides.length).toBeGreaterThan(0);
  return { lecture, csrf };
}

function databaseUrl() {
  const value = process.env.E2E_DATABASE_URL ?? DEFAULT_DATABASE_URL;
  if (!new URL(value).pathname.toLowerCase().includes("e2e")) {
    throw new Error("Student draft race tests require an isolated E2E PostgreSQL database.");
  }
  process.env.DATABASE_URL = value;
  process.env.LEARNBUDDY_REPOSITORY = "postgres";
  return value;
}

function database() {
  return postgres(databaseUrl(), { max: 4, prepare: false });
}

function repository() {
  databaseUrl();
  return getLectureRepository();
}

function draftVariants(lecture: Lecture, name: string): QuestionVariant[] {
  const levels: QuestionVariant["level"][] = ["4.0", "3.0", "2.0", "1.0"];
  return levels.map((level, index) => ({
    level,
    points: 4 - index,
    text: `${name}: Frage auf Niveau ${level}`,
    answers: [
      { key: "A", text: `${name}: richtige Antwort ${level}`, correct: true },
      { key: "B", text: `${name}: Ablenkung B ${level}`, correct: false },
      { key: "C", text: `${name}: Ablenkung C ${level}`, correct: false },
      { key: "D", text: `${name}: Ablenkung D ${level}`, correct: false }
    ],
    explanation: `${name}: Die richtige Antwort beschreibt den tragenden Schmierfilm korrekt.`,
    promptVersion: "postgres-race-test",
    familyId: `test-family-${name}`,
    familySource: "student_question",
    slideId: lecture.slides[0]?.id,
    sourceRef: "PostgreSQL Race Test",
    learningObjective: "Schmierfilmaufbau und Lastübertragung erklären."
  }));
}

async function seedQuestion(
  sql: ReturnType<typeof postgres>,
  lecture: Lecture,
  options: {
    text: string;
    draftStatus: "failed" | "generating" | "draft";
    attemptId?: string;
    attemptAgeMs?: number;
    reviewStatus?: "draft" | "approved" | "rejected";
    variants?: QuestionVariant[];
  }
) {
  const attemptAt = options.attemptAgeMs === undefined ? null : new Date(Date.now() - options.attemptAgeMs);
  const [question] = await sql<{ id: string }[]>`
    insert into student_chat_questions (
      lecture_id, pseudonym, question_text, status, relevance_reason, source_topic,
      moderation_provider, moderation_model, moderation_confidence, moderation_signals,
      exam_draft_status, exam_draft_attempt_at, exam_draft_attempt_id
    ) values (
      ${lecture.id}, 'Race Student', ${options.text}, 'accepted', 'Test accepted question', 'Gleitlagerung',
      'e2e', 'postgres-race-test', 100, '[]'::jsonb,
      ${options.draftStatus}, ${attemptAt}, ${options.attemptId ?? null}
    ) returning id::text as id
  `;

  if (options.reviewStatus) {
    const variants = options.variants ?? draftVariants(lecture, options.text);
    await sql`
      insert into question_review_items (
        lecture_id, source_student_question_id, source_title, status, variants_json
      ) values (
        ${lecture.id}, ${question.id}, ${`Chatfrage: ${options.text}`}, ${options.reviewStatus}, ${JSON.stringify(variants)}::jsonb
      )
    `;
  }

  return question.id;
}

async function startPresentation(lecture: Lecture) {
  await commandLiveSession(lecture, { action: "start", revision: 0 });
  await commandLiveSession(lecture, { action: "slide", revision: 1, slideIndex: 0, showIntro: false });
}

test("ticker renders retry/reject controls only after generation is stale", () => {
  const renderItem = (generationStale: boolean) => renderToStaticMarkup(createElement(StudentQuestionTickerItem, {
    question: {
      id: "ticker-stale-state",
      text: "Wie verändert die Viskosität die Tragfähigkeit?",
      pseudonym: "Student",
      status: "accepted",
      createdAt: new Date().toISOString(),
      attemptAt: new Date(Date.now() - (generationStale ? 120_000 : 1_000)).toISOString(),
      examDraftStatus: "generating",
      generationStale,
      draft: null
    } satisfies TickerQuestion,
    canPublish: true,
    busyId: null,
    onPublish: () => undefined,
    onRetry: () => undefined,
    onReject: () => undefined
  }));

  const staleMarkup = renderItem(true);
  expect(staleMarkup).toContain("Die Entwurfserstellung hängt möglicherweise fest.");
  expect(staleMarkup).toContain("Erstellung neu starten");
  expect(staleMarkup).toContain("Entwurf ablehnen");

  const activeMarkup = renderItem(false);
  expect(activeMarkup).toContain("Entwurf wird vorbereitet");
  expect(activeMarkup).not.toContain("Erstellung neu starten");
  expect(activeMarkup).not.toContain("Entwurf ablehnen");
});

test("slow student draft generation acknowledges once, stays private, and cannot bypass profile rate limits", async ({ page, browser }) => {
  test.skip(
    process.env.E2E_AI_PROVIDER !== "learnordie-responses" || Number(process.env.E2E_STUDENT_DRAFT_DELAY_MS) < 15_000,
    "Run with E2E_AI_PROVIDER=learnordie-responses and a 15s+ E2E_STUDENT_DRAFT_DELAY_MS."
  );
  test.setTimeout(90_000);

  const { lecture, csrf } = await lectureFixture(page);
  const sql = database();
  const studentContext = await browser.newContext();
  try {
    await startPresentation(lecture);
    const student = await studentContext.newPage();
    await student.goto(`/l/${lecture.publicToken}`);
    await expect(student.getByRole("button", { name: "Frage stellen", exact: true })).toBeVisible();

    async function sendFromUI(text: string) {
      if (await student.getByLabel("Deine Frage", { exact: true }).count() === 0) {
        await student.getByRole("button", { name: "Frage stellen", exact: true }).click();
      }
      await student.getByLabel("Deine Frage", { exact: true }).fill(text);
      const pending = student.waitForResponse((response) => (
        response.request().method() === "POST" && response.url().includes(`/api/lecture/${lecture.publicToken}/chat-questions`)
      ));
      const startedAt = Date.now();
      await student.getByRole("button", { name: "Senden", exact: true }).click();
      const response = await pending;
      const elapsedMs = Date.now() - startedAt;
      expect(response.status()).toBe(200);
      expect(elapsedMs).toBeLessThan(15_000);
      return await response.json() as { accepted: boolean; chatQuestion: { id: string; examDraftStatus: string } };
    }

    const firstText = "E2E_SLOW_STUDENT_DRAFT_A: Wie beeinflusst die Viskosität den Schmierfilm im Stribeck-Bereich?";
    const secondText = "E2E_SLOW_STUDENT_DRAFT_B: Warum verändert die Viskosität den Schmierfilm im Stribeck-Bereich?";
    const thirdText = "Wie beschreibt die Stribeck-Kurve den Übergang der Reibungszustände?";
    const first = await sendFromUI(firstText);
    expect(first.accepted).toBe(true);
    expect(first.chatQuestion.examDraftStatus).toBe("generating");

    const profileResponse = await student.request.get("/api/student/profile");
    const { profile } = await profileResponse.json() as { profile: { id: string; pseudonym: string } };
    expect(profile?.id).toBeTruthy();
    expect(profile?.pseudonym).toBeTruthy();
    const enrollment = await getStudentRepository().getActiveClaim(profile.id, seriesIdForLecture(lecture));
    expect(enrollment).toBeTruthy();
    const expectedPseudonym = enrollment?.displayName?.trim() || profile.pseudonym;
    const browserKey = await student.evaluate(() => localStorage.getItem("lb_student_key"));
    expect(browserKey).toBeTruthy();

    const rotation = await student.request.post("/api/student/profile", {
      headers: { "content-type": "application/json" },
      data: { anonymousKey: "attacker_rotated_student_key_001" }
    });
    expect(rotation.status()).toBe(200);
    expect(((await rotation.json()) as { profile: { id: string } }).profile.id).toBe(profile.id);

    const second = await sendFromUI(secondText);
    expect(second.accepted).toBe(true);
    expect(second.chatQuestion.examDraftStatus).toBe("generating");
    const rejected = await page.request.post(`/api/lectures/${lecture.id}/student-question-ticker`, {
      headers: { "x-learnbuddy-csrf": csrf, "content-type": "application/json" },
      data: { action: "reject", questionId: second.chatQuestion.id }
    });
    expect(rejected.status()).toBe(200);

    const thirdResponse = await student.request.post(`/api/lecture/${lecture.publicToken}/chat-questions`, {
      headers: { "content-type": "application/json" },
      data: { text: thirdText, pseudonym: "Forged Lecturer Reveal", anonymousKey: "forged_rotated_key_001" }
    });
    expect(thirdResponse.status()).toBe(200);
    const third = await thirdResponse.json() as { accepted: boolean; chatQuestion: { id: string; pseudonym: string } };
    expect(third.accepted).toBe(true);
    expect(third.chatQuestion.pseudonym).toBe(expectedPseudonym);

    const mockPort = process.env.E2E_AI_MOCK_PORT ?? "4070";
    const mockHost = process.env.E2E_HOST ?? "127.0.0.1";
    const statsBeforeLimit = await student.request.get(`http://${mockHost}:${mockPort}/__test/stats`);
    const before = await statsBeforeLimit.json() as { moderationRequests: number };
    const limited = await student.request.post(`/api/lecture/${lecture.publicToken}/chat-questions`, {
      headers: { "content-type": "application/json" },
      data: { text: "Kann ein anderer Schlüssel das Rate Limit umgehen?", pseudonym: "Race Student", anonymousKey: "another_forged_key_001" }
    });
    expect(limited.status()).toBe(429);
    const statsAfterLimit = await student.request.get(`http://${mockHost}:${mockPort}/__test/stats`);
    const after = await statsAfterLimit.json() as { moderationRequests: number };
    expect(after.moderationRequests).toBe(before.moderationRequests);

    const rows = await sql<{ id: string; question_text: string; anonymous_key: string | null; pseudonym: string }[]>`
      select id::text as id, question_text, anonymous_key, pseudonym
      from student_chat_questions where lecture_id = ${lecture.id}
    `;
    const questions = [firstText, secondText, thirdText];
    for (const text of questions) {
      const matches = rows.filter((row) => row.question_text === text);
      expect(matches).toHaveLength(1);
      expect(matches[0].anonymous_key).toBe(browserKey);
    }
    expect(rows.find((row) => row.question_text === thirdText)?.pseudonym).toBe(expectedPseudonym);
    const attempts = await sql<{ count: number }[]>`
      select count(*)::int as count
      from student_chat_question_attempts
      where lecture_id = ${lecture.id} and student_profile_id = ${profile.id}
    `;
    expect(attempts[0].count).toBe(3);

    await expect.poll(async () => {
      const response = await page.request.get(`/api/lectures/${lecture.id}/student-question-ticker`);
      const payload = await response.json() as { questions: Array<{ id: string; examDraftStatus: string; draft: unknown }> };
      const byId = new Map(payload.questions.map((question) => [question.id, question]));
      return [byId.get(first.chatQuestion.id)?.examDraftStatus, byId.get(second.chatQuestion.id)?.examDraftStatus, byId.get(third.chatQuestion.id)?.examDraftStatus];
    }, { timeout: 45_000, intervals: [250, 500, 1000] }).toEqual(["draft", "rejected", "draft"]);

    const tickerResponse = await page.request.get(`/api/lectures/${lecture.id}/student-question-ticker`);
    const tickerBody = await tickerResponse.json() as { questions: Array<{ id: string; pseudonym: string }> };
    expect(tickerBody.questions.find((question) => question.id === third.chatQuestion.id)?.pseudonym).toBe(expectedPseudonym);

    await expect(student.getByText("Welche Schicht trägt die Last im hydrodynamischen Gleitlager?", { exact: true })).toHaveCount(0);
  } finally {
    await studentContext.close();
    await sql.end();
  }
});

test("ticker exposes stale generation actions, reclaims safely, and fences the old attempt", async ({ page }) => {
  test.skip(process.env.E2E_AI_PROVIDER !== "learnordie-responses", "Run with the deterministic local Learnordie Responses mock.");
  test.setTimeout(60_000);

  const { lecture, csrf } = await lectureFixture(page);
  const sql = database();
  const repo = repository();
  try {
    const staleAttemptId = randomUUID();
    const staleQuestionId = await seedQuestion(sql, lecture, {
      text: "Wie verändert die Viskosität die Tragfähigkeit im Gleitlager?",
      draftStatus: "generating",
      attemptId: staleAttemptId,
      attemptAgeMs: 120_000
    });
    const rejectAttemptId = randomUUID();
    const rejectQuestionId = await seedQuestion(sql, lecture, {
      text: "Welche Aufgabe übernimmt der Schmierfilm?",
      draftStatus: "generating",
      attemptId: rejectAttemptId,
      attemptAgeMs: 120_000
    });
    const activeQuestionId = await seedQuestion(sql, lecture, {
      text: "Wie wirkt sich die Lagerlast auf den Schmierfilm aus?",
      draftStatus: "generating",
      attemptId: randomUUID(),
      attemptAgeMs: 1_000
    });

    const tickerUrl = `/api/lectures/${lecture.id}/student-question-ticker`;
    const initialResponse = await page.request.get(tickerUrl);
    expect(initialResponse.status()).toBe(200);
    const initialBody = await initialResponse.json() as { questions: Array<{
      id: string;
      attemptAt: string | null;
      examDraftStatus: string;
      generationStale: boolean;
    }> };
    const staleItem = initialBody.questions.find((question) => question.id === staleQuestionId);
    expect(staleItem).toMatchObject({ examDraftStatus: "generating", generationStale: true });
    expect(Date.parse(staleItem!.attemptAt ?? "")).toBeLessThan(Date.now() - 90_000);
    expect(initialBody.questions.find((question) => question.id === activeQuestionId)).toMatchObject({
      examDraftStatus: "generating",
      generationStale: false
    });

    const activeRetry = await page.request.post(tickerUrl, {
      headers: { "x-learnbuddy-csrf": csrf, "content-type": "application/json" },
      data: { action: "retry", questionId: activeQuestionId }
    });
    expect(activeRetry.status()).toBe(409);

    const retryResponse = await page.request.post(tickerUrl, {
      headers: { "x-learnbuddy-csrf": csrf, "content-type": "application/json" },
      data: { action: "retry", questionId: staleQuestionId }
    });
    expect(retryResponse.status()).toBe(200);
    const retryBody = await retryResponse.json() as { questions: Array<{
      id: string;
      examDraftStatus: string;
      generationStale: boolean;
      draft: unknown;
    }> };
    expect(retryBody.questions.find((question) => question.id === staleQuestionId)).toMatchObject({
      examDraftStatus: "draft",
      generationStale: false
    });
    expect(retryBody.questions.find((question) => question.id === staleQuestionId)?.draft).toBeTruthy();

    const lateSave = await repo.saveStudentExamDraft({
      lectureId: lecture.id,
      chatQuestionId: staleQuestionId,
      attemptId: staleAttemptId,
      variants: draftVariants(lecture, "late-old-generation")
    });
    expect(lateSave).toBeNull();

    const rejectResponse = await page.request.post(tickerUrl, {
      headers: { "x-learnbuddy-csrf": csrf, "content-type": "application/json" },
      data: { action: "reject", questionId: rejectQuestionId }
    });
    expect(rejectResponse.status()).toBe(200);
    const rejectBody = await rejectResponse.json() as { questions: Array<{
      id: string;
      examDraftStatus: string;
      generationStale: boolean;
    }> };
    expect(rejectBody.questions.find((question) => question.id === rejectQuestionId)).toMatchObject({
      examDraftStatus: "rejected",
      generationStale: false
    });

    const lateRejectedSave = await repo.saveStudentExamDraft({
      lectureId: lecture.id,
      chatQuestionId: rejectQuestionId,
      attemptId: rejectAttemptId,
      variants: draftVariants(lecture, "late-rejected-generation")
    });
    expect(lateRejectedSave).toBeNull();
  } finally {
    await sql.end();
  }
});

test("PostgreSQL serializes begin/save/reject/archive races without stale drafts or duplicate families", async ({ page }) => {
  test.setTimeout(60_000);
  const { lecture } = await lectureFixture(page);
  const sql = database();
  const repo = repository();
  try {
    const staleAttemptId = "race-attempt-before-reclaim";
    const reclaimId = await seedQuestion(sql, lecture, {
      text: "begin-save-reclaim",
      draftStatus: "generating",
      attemptId: staleAttemptId,
      attemptAgeMs: 120_000
    });
    const now = new Date();
    const [begun, saved] = await Promise.all([
      repo.beginStudentExamDraftAttempt({
        lectureId: lecture.id,
        chatQuestionId: reclaimId,
        now,
        since: new Date(now.getTime() - 15 * 60_000),
        cooldownMs: 30_000,
        staleGenerationMs: 0,
        maxAttempts: 12
      }),
      repo.saveStudentExamDraft({
        lectureId: lecture.id,
        chatQuestionId: reclaimId,
        attemptId: staleAttemptId,
        variants: draftVariants(lecture, "begin-save-reclaim")
      })
    ]);
    const [reclaimState] = await sql<{ exam_draft_status: string; exam_draft_attempt_id: string | null }[]>`
      select exam_draft_status, exam_draft_attempt_id from student_chat_questions where id = ${reclaimId}
    `;
    expect(["draft", "generating"]).toContain(reclaimState.exam_draft_status);
    if (reclaimState.exam_draft_status === "draft") {
      expect(begun.status).toBe("draft");
      expect(saved).not.toBeNull();
    } else {
      expect(begun.status).toBe("started");
      expect(reclaimState.exam_draft_attempt_id).not.toBe(staleAttemptId);
      expect(saved).toBeNull();
    }

    const rejectAttemptId = "race-attempt-before-reject";
    const rejectId = await seedQuestion(sql, lecture, {
      text: "generation-vs-reject",
      draftStatus: "generating",
      attemptId: rejectAttemptId,
      reviewStatus: "draft",
      variants: draftVariants(lecture, "generation-vs-reject")
    });
    const [review] = await sql<{ id: string }[]>`
      select id::text as id from question_review_items where lecture_id = ${lecture.id} and source_student_question_id = ${rejectId}
    `;
    await Promise.all([
      repo.saveStudentExamDraft({ lectureId: lecture.id, chatQuestionId: rejectId, attemptId: rejectAttemptId, variants: draftVariants(lecture, "generation-vs-reject-save") }),
      repo.decideQuestionReview(lecture.id, review.id, "rejected", "race-test")
    ]);
    const [rejectedState] = await sql<{ exam_draft_status: string; status: string }[]>`
      select q.exam_draft_status, r.status
      from student_chat_questions q join question_review_items r on r.source_student_question_id = q.id::text
      where q.id = ${rejectId}
    `;
    expect(rejectedState).toEqual({ exam_draft_status: "rejected", status: "rejected" });

    const publishId = await seedQuestion(sql, lecture, {
      text: "begin-vs-archive-after-publication",
      draftStatus: "draft",
      reviewStatus: "draft",
      variants: draftVariants(lecture, "begin-vs-archive-after-publication")
    });
    await startPresentation(lecture);
    await commandLiveSession(lecture, { action: "publishDraft", revision: 2, questionId: publishId });
    const publishNow = new Date();
    const [afterPublishBegin, archived] = await Promise.all([
      repo.beginStudentExamDraftAttempt({
        lectureId: lecture.id,
        chatQuestionId: publishId,
        now: publishNow,
        since: new Date(publishNow.getTime() - 15 * 60_000),
        cooldownMs: 30_000,
        staleGenerationMs: 90_000,
        maxAttempts: 12
      }),
      repo.archivePublishedStudentExamDraft(lecture.id, publishId)
    ]);
    expect(afterPublishBegin.status).toBe("published");
    expect(archived).not.toBeNull();
    const [familyCount] = await sql<{ count: number }[]>`
      select count(*)::int as count from questions where lecture_id = ${lecture.id} and source = ${`student_question:${publishId}`}
    `;
    expect(familyCount.count).toBe(1);
  } finally {
    await sql.end();
  }
});

test("PostgreSQL makes reject/approve publication races and duplicate publication idempotent", async ({ page }) => {
  test.setTimeout(60_000);
  const { lecture } = await lectureFixture(page);
  const sql = database();
  const repo = repository();
  try {
    await startPresentation(lecture);
    const rejectId = await seedQuestion(sql, lecture, {
      text: "reject-vs-publication",
      draftStatus: "draft",
      reviewStatus: "draft",
      variants: draftVariants(lecture, "reject-vs-publication")
    });
    const [rejectReview] = await sql<{ id: string }[]>`
      select id::text as id from question_review_items where lecture_id = ${lecture.id} and source_student_question_id = ${rejectId}
    `;
    const rejectResults = await Promise.allSettled([
      repo.decideQuestionReview(lecture.id, rejectReview.id, "rejected", "race-test"),
      commandLiveSession(lecture, { action: "publishDraft", revision: 2, questionId: rejectId })
    ]);
    const [rejectState] = await sql<{ exam_draft_status: string; review_status: string; family_count: number }[]>`
      select q.exam_draft_status, r.status as review_status,
        (select count(*)::int from questions where lecture_id = q.lecture_id and source = ${`student_question:${rejectId}`}) as family_count
      from student_chat_questions q join question_review_items r on r.source_student_question_id = q.id::text
      where q.id = ${rejectId}
    `;
    if (rejectState.exam_draft_status === "published") {
      expect(rejectState).toEqual({ exam_draft_status: "published", review_status: "approved", family_count: 1 });
      expect(rejectResults.every((result) => result.status === "fulfilled")).toBe(true);
    } else {
      expect(rejectState).toEqual({ exam_draft_status: "rejected", review_status: "rejected", family_count: 0 });
      expect(rejectResults[1].status).toBe("rejected");
    }

    // Use a separate lecture so an active 60-second live round cannot affect this race.
    const second = await lectureFixture(page);
    await startPresentation(second.lecture);
    const approveId = await seedQuestion(sql, second.lecture, {
      text: "approve-vs-publication-and-double-publish",
      draftStatus: "draft",
      reviewStatus: "draft",
      variants: draftVariants(second.lecture, "approve-vs-publication")
    });
    const [approveReview] = await sql<{ id: string }[]>`
      select id::text as id from question_review_items where lecture_id = ${second.lecture.id} and source_student_question_id = ${approveId}
    `;
    await Promise.all([
      repo.decideQuestionReview(second.lecture.id, approveReview.id, "approved", "race-test"),
      commandLiveSession(second.lecture, { action: "publishDraft", revision: 2, questionId: approveId })
    ]);
    await Promise.all([
      commandLiveSession(second.lecture, { action: "publishDraft", revision: 2, questionId: approveId }),
      commandLiveSession(second.lecture, { action: "publishDraft", revision: 2, questionId: approveId })
    ]);
    const [approvedState] = await sql<{ exam_draft_status: string; review_status: string; family_count: number; variant_count: number }[]>`
      select q.exam_draft_status, r.status as review_status,
        (select count(*)::int from questions where lecture_id = q.lecture_id and source = ${`student_question:${approveId}`}) as family_count,
        (select count(*)::int from questions f join question_variants v on v.question_id = f.id where f.lecture_id = q.lecture_id and f.source = ${`student_question:${approveId}`}) as variant_count
      from student_chat_questions q join question_review_items r on r.source_student_question_id = q.id::text
      where q.id = ${approveId}
    `;
    expect(approvedState).toEqual({ exam_draft_status: "published", review_status: "approved", family_count: 1, variant_count: 4 });
  } finally {
    await sql.end();
  }
});

test("PostgreSQL admits exactly the configured lecture-wide draft retry budget under concurrency", async ({ page }) => {
  test.setTimeout(60_000);
  const { lecture } = await lectureFixture(page);
  const sql = database();
  const repo = repository();
  try {
    const questionIds = await Promise.all(Array.from({ length: 13 }, (_, index) => seedQuestion(sql, lecture, {
      text: `retry-budget-${index}`,
      draftStatus: "failed"
    })));
    const now = new Date();
    const results = await Promise.all(questionIds.map((chatQuestionId) => repo.beginStudentExamDraftAttempt({
      lectureId: lecture.id,
      chatQuestionId,
      now,
      since: new Date(now.getTime() - 15 * 60_000),
      cooldownMs: 30_000,
      staleGenerationMs: 90_000,
      maxAttempts: 12
    })));
    expect(results.filter((result) => result.status === "started")).toHaveLength(12);
    expect(results.filter((result) => result.status === "rate_limited")).toHaveLength(1);
    const [attemptCount] = await sql<{ count: number }[]>`
      select count(*)::int as count from student_exam_draft_attempts where lecture_id = ${lecture.id}
    `;
    expect(attemptCount.count).toBe(12);
  } finally {
    await sql.end();
  }
});
