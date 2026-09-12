import crypto from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import postgres from "postgres";
import { seriesIdForLecture, seriesIdFromTitle } from "../../src/lib/series";
import type { Lecture, StudentDashboard, StudentEnrollment } from "../../src/lib/types";

async function login(page: Page, email: string) {
  await page.goto("/lecturer/login");
  await page.getByLabel("E-Mail", { exact: true }).fill(email);
  await page.getByRole("button", { name: "Code senden", exact: true }).click();
  // The isolated E2E server uses console mail; exercise its real one-use login.
  await page.getByRole("link", { name: "Direkt zum Dozentenbereich", exact: true }).click();
  await expect(page).toHaveURL(/\/lecturer$/);
  await page.reload();
  const csrf = await page.locator("[data-csrf-token]").first().getAttribute("data-csrf-token");
  expect(csrf).toBeTruthy();
  return { "x-learnbuddy-csrf": csrf! };
}

async function dashboard(page: Page): Promise<StudentDashboard> {
  const response = await page.request.get("/api/student/dashboard");
  expect(response.ok()).toBe(true);
  return (await response.json()).dashboard;
}

test("same-title series keep canonical identity, owner authority and lazy students isolated in PostgreSQL", async ({ browser }, testInfo) => {
  test.setTimeout(120_000);
  const databaseUrl = process.env.E2E_DATABASE_URL;
  if (!databaseUrl) throw new Error("This regression requires the isolated E2E_DATABASE_URL, never a production database.");
  const target = new URL(databaseUrl);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || !target.pathname.includes("e2e")) {
    throw new Error("Refusing identity fixture outside a loopback E2E database.");
  }
  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  const contexts = await Promise.all(Array.from({ length: 4 }, () => browser.newContext()));
  const priorDatabaseUrl = process.env.DATABASE_URL;
  const priorRepository = process.env.LEARNBUDDY_REPOSITORY;
  const errors: string[] = [];
  try {
    const [teacherA, teacherB, studentA, studentB] = await Promise.all(contexts.map((context) => context.newPage()));
    for (const page of [teacherA, teacherB, studentA, studentB]) {
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("console", (message) => {
        if (message.type() === "error" && !message.text().includes("Failed to load resource")) errors.push(message.text());
      });
      page.on("requestfailed", (request) => {
        if (request.failure()?.errorText !== "net::ERR_ABORTED") errors.push(`Network failure: ${request.url()}`);
      });
      page.on("response", (response) => { if (response.status() >= 500) errors.push(`HTTP ${response.status()}: ${response.url()}`); });
    }
    const nonce = crypto.randomUUID().slice(0, 8);
    const emails = [`series-a-${nonce}@example.test`, `series-b-${nonce}@example.test`];
    const headersA = await login(teacherA, emails[0]);
    const headersB = await login(teacherB, emails[1]);
    const seriesTitle = `Identical series ${nonce}`;
    const slug = seriesIdFromTitle(seriesTitle);
    const create = async (page: Page, headers: Record<string, string>, suffix: string): Promise<Lecture> => {
      const response = await page.request.post("/api/lectures", {
        headers,
        data: { title: `Only teacher ${suffix} ${nonce}`, seriesTitle, liveAt: new Date().toISOString(), examDate: "2030-12-01" }
      });
      expect(response.status()).toBe(201);
      const { lecture } = await response.json();
      expect(lecture.seriesId).toMatch(/^[0-9a-f-]{36}$/i);
      return lecture;
    };
    const lectureA = await create(teacherA, headersA, "A");
    const idA = seriesIdForLecture(lectureA);
    // A unique old link resolves to the UUID, not a newly invented slug identity.
    const legacyShare = await teacherA.request.get(`/api/lecturer/series/${slug}/share`);
    expect(legacyShare.status()).toBe(200);
    expect((await legacyShare.json()).share.seriesId).toBe(idA);
    await studentA.goto(`/learn/${lectureA.publicToken}`);
    await expect(studentA.locator("[data-slide-engine=v1]")).toBeVisible();
    await expect(studentA.getByRole("dialog", { name: /Pseudonym/ })).toHaveCount(0);
    await expect.poll(async () => (await dashboard(studentA))?.series?.[0]?.seriesId).toBe(idA);
    const legacyEnrollment = await studentA.request.post("/api/student/enrollments", {
      data: { seriesId: slug, seriesTitle, lectureId: lectureA.id, source: "direct_learn_link" }
    });
    expect(legacyEnrollment.status()).toBe(200);
    expect((await legacyEnrollment.json()).enrollment.seriesId).toBe(idA);

    const lectureB = await create(teacherB, headersB, "B");
    const idB = seriesIdForLecture(lectureB);
    expect(idB).not.toBe(idA);
    const owners = await sql`select s.id, u.email from lecture_series s join users u on u.id = s.owner_id where s.id in (${idA}, ${idB})`;
    expect(owners.map((row) => [row.id, row.email]).sort()).toEqual([[idA, emails[0]], [idB, emails[1]]].sort());
    const codeA = `ISO-A-${nonce}`.toUpperCase();
    const codeB = `ISO-B-${nonce}`.toUpperCase();
    const codeResponseA = await teacherA.request.patch(`/api/lecturer/series/${idA}/join-code`, { headers: headersA, data: { code: codeA } });
    const codeResponseB = await teacherB.request.patch(`/api/lecturer/series/${idB}/join-code`, { headers: headersB, data: { code: codeB } });
    expect(codeResponseA.status()).toBe(200);
    expect(codeResponseB.status()).toBe(200);
    const codeIdA = (await codeResponseA.json()).joinCode.id as string;

    // API authorization must not accept another tenant's UUID or the ambiguous old title.
    for (const [page, headers, forbidden] of [[teacherA, headersA, idB], [teacherB, headersB, idA]] as const) {
      for (const id of [forbidden, slug]) {
        expect((await page.request.get(`/api/lecturer/series/${id}/share`)).status()).toBe(404);
        expect((await page.request.patch(`/api/lecturer/series/${id}/join-code`, { headers, data: { code: `ATTACK-${nonce}` } })).status()).toBe(404);
        expect((await page.request.delete(`/api/lecturer/series/${id}/join-code`, { headers })).status()).toBe(404);
      }
    }
    // Independently invoke the actual repository: no route/UI guard may be required.
    process.env.DATABASE_URL = databaseUrl;
    process.env.LEARNBUDDY_REPOSITORY = "postgres";
    const { getStudentRepository } = await import("../../src/server/student-repository");
    const repository = getStudentRepository();
    expect(await repository.getShareInfoForSeries(emails[1], idA)).toBeNull();
    expect(await repository.getShareInfoForSeries(emails[0], slug)).toBeNull();
    await expect(repository.setLectureSeriesJoinCode(emails[1], idA, "FORBIDDEN-CODE")).rejects.toThrow("Vorlesungsreihe nicht gefunden.");
    await expect(repository.setLectureSeriesJoinCode(emails[0], slug, "AMBIGUOUS-CODE")).rejects.toThrow("Vorlesungsreihe nicht gefunden.");
    expect(await repository.disableJoinCode(emails[1], codeIdA)).toBeNull();
    expect(await repository.disableJoinCode(undefined, codeIdA)).toBeNull();
    const unchanged = await sql`select code, enabled from join_codes where id = ${codeIdA}`;
    expect(unchanged).toEqual([{ code: codeA, enabled: true }]);
    expect((await repository.resolveJoinCode(codeA))?.seriesId).toBe(idA);
    expect((await repository.resolveJoinCode(codeB))?.seriesId).toBe(idB);

    await studentB.goto(`/learn/${lectureB.publicToken}`);
    await expect(studentB.locator("[data-slide-engine=v1]")).toBeVisible();
    await expect.poll(async () => (await dashboard(studentB))?.series?.[0]?.seriesId).toBe(idB);
    const commonAlias = `Nordlicht-${nonce}`;
    const responses = await Promise.all(([[studentA, idA], [studentB, idB]] as const).map(([page, seriesId]) =>
      page.request.post("/api/student/claim", { data: { seriesId, displayName: commonAlias } })
    ));
    expect(responses.map((response) => response.status())).toEqual([200, 200]);
    const profileA = (await (await studentA.request.get("/api/student/profile")).json()).profile;
    const profileB = (await (await studentB.request.get("/api/student/profile")).json()).profile;
    expect(profileA.id).not.toBe(profileB.id);
    const keyA = await studentA.evaluate(() => localStorage.getItem("lb_student_key"));
    expect((await repository.getRankingClaim(keyA!, idA))?.displayName).toBe(commonAlias);
    expect(await repository.getRankingClaim(keyA!, idB)).toBeNull();
    expect(await repository.getRankingClaim(keyA!, slug)).toBeNull();

    for (const [page, ownId, otherId, ownLecture, otherLecture] of [
      [studentA, idA, idB, lectureA, lectureB], [studentB, idB, idA, lectureB, lectureA]
    ] as const) {
      expect((await (await page.request.get(`/api/student/claim?seriesId=${slug}`)).json()).claim).toBeNull();
      expect((await page.request.post("/api/student/claim", { data: { seriesId: slug, displayName: "No-Slug-Claim" } })).status()).toBe(409);
      expect((await (await page.request.get(`/api/student/claim?seriesId=${otherId}`)).json()).claim).toBeNull();
      for (const [seriesId, lectureId] of [[slug, ownLecture.id], [ownId, otherLecture.id]]) {
        expect((await page.request.post("/api/student/enrollments", {
          data: { seriesId, seriesTitle, lectureId, source: "direct_learn_link" }
        })).status()).toBe(404);
      }
      const view = await dashboard(page);
      expect(view.series).toHaveLength(1);
      expect(view.series[0].seriesId).toBe(ownId);
      expect(view.series[0].displayName).toBe(commonAlias);
      expect(view.series[0].events.map((event) => event.lectureId)).toEqual([ownLecture.id]);
      expect(view.series[0].readiness?.seriesId).toBe(ownId);
      expect(view.series[0].readiness?.lectureCount).toBe(1);
      await page.goto("/student");
      await expect(page.getByText(`Name in dieser Vorlesung: ${commonAlias}`, { exact: true })).toBeVisible();
      await expect(page.locator("main")).not.toContainText(otherLecture.title);
      await page.getByRole("button", { name: "Anzeigename ändern", exact: true }).click();
      await page.getByRole("textbox", { name: "Name in dieser Vorlesung", exact: true }).fill(`${commonAlias}-neu`);
      await page.getByRole("button", { name: "Speichern", exact: true }).click();
      await expect(page.getByText(`Name in dieser Vorlesung: ${commonAlias}-neu`, { exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByText(`Name in dieser Vorlesung: ${commonAlias}-neu`, { exact: true })).toBeVisible();
      await page.goto(`/student/series/${ownId}`);
      await expect(page.getByRole("heading", { name: seriesTitle, exact: true })).toBeVisible();
      await expect(page.locator("main")).not.toContainText(otherLecture.title);
      await testInfo.attach(`isolated-series-${ownId}`, { body: await page.screenshot(), contentType: "image/png" });
      await page.goto(`/student/series/${slug}`);
      await expect(page).toHaveURL(/\/student$/);
    }
    const actualEnrollments = await sql`select series_id, student_profile_id, display_name from student_enrollments
      where student_profile_id in (${profileA.id}, ${profileB.id}) and status = 'active' order by series_id`;
    expect(actualEnrollments.map((row) => [row.series_id, row.student_profile_id, row.display_name])).toEqual(
      [[idA, profileA.id, `${commonAlias}-neu`], [idB, profileB.id, `${commonAlias}-neu`]].sort()
    );
    // One browser may deliberately join both: IDs, not the title, separate its claims.
    const both = await studentA.request.post("/api/student/enrollments", {
      data: { seriesId: idB, seriesTitle, lectureId: lectureB.id, source: "direct_learn_link", displayName: `Second-${nonce}` }
    });
    expect(both.status()).toBe(200);
    const bothEnrollment = (await both.json()).enrollment as StudentEnrollment;
    expect(bothEnrollment.seriesId).toBe(idB);
    expect((await dashboard(studentA)).series.map((series) => series.seriesId).sort()).toEqual([idA, idB].sort());
    expect((await studentA.request.delete(`/api/student/enrollments/${bothEnrollment.id}`)).status()).toBe(200);
    expect((await dashboard(studentB)).series[0].displayName).toBe(`${commonAlias}-neu`);

    for (const [page, ownLecture, otherLecture, code] of [[teacherA, lectureA, lectureB, codeA], [teacherB, lectureB, lectureA, codeB]] as const) {
      await page.goto("/lecturer");
      await page.getByLabel("Studio-Menü", { exact: true }).click();
      await expect(page.getByRole("option", { name: new RegExp(ownLecture.title) })).toBeVisible();
      await expect(page.getByRole("option", { name: new RegExp(otherLecture.title) })).toHaveCount(0);
      await expect(page.locator(".join-code-value")).toHaveText(code);
      await page.goto("/api/auth/logout");
      await page.goto("/lecturer");
      await expect(page).toHaveURL(/\/lecturer\/login$/);
      await page.reload();
      expect((await page.request.get("/api/lectures")).status()).toBe(401);
    }
    expect(errors).toEqual([]);
  } finally {
    if (priorDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = priorDatabaseUrl;
    if (priorRepository === undefined) delete process.env.LEARNBUDDY_REPOSITORY;
    else process.env.LEARNBUDDY_REPOSITORY = priorRepository;
    await Promise.all(contexts.map((context) => context.close()));
    await sql.end();
  }
});
