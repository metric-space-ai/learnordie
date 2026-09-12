import { expect, test, type Page } from "@playwright/test";
import jsQR from "jsqr";
import { seriesIdFromTitle } from "../../src/lib/series";

const password = "e2e-only-test-password-not-for-production";

async function testLogin(page: Page, email: string) {
  await page.goto("/lecturer/login");
  await page.getByText("Mit Testkonto anmelden", { exact: true }).click();
  await page.getByLabel("Testkonto E-Mail", { exact: true }).fill(email);
  await page.getByLabel("Testkonto Passwort", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Testkonto öffnen" }).click();
  await expect(page).toHaveURL(/\/lecturer$/);
}

test("temporary lecturer login, QR intro, persistent student link and tenant isolation", async ({ page, browser }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await testLogin(page, "qa-qr@learnordie.test");
  await page.reload();
  await expect(page).toHaveURL(/\/lecturer$/);
  const csrf = await page.locator("[data-csrf-token]").getAttribute("data-csrf-token");
  expect(csrf).toBeTruthy();
  const created = await page.request.post("/api/lectures", {
    headers: { "x-learnbuddy-csrf": csrf! },
    data: { title: "QR classroom regression", seriesTitle: `QR series ${Date.now()}`, liveAt: new Date().toISOString(), examDate: "2030-12-01" }
  });
  expect(created.status()).toBe(201);
  const { lecture } = await created.json();
  await page.goto(`/lecturer/live/${lecture.publicToken}`);
  const intro = page.getByRole("region", { name: "Vorlesung beitreten" });
  await expect(intro).toBeVisible();
  const url = new URL(`/l/${lecture.publicToken}`, page.url()).href;
  await expect(intro.getByRole("link", { name: url, exact: true })).toHaveAttribute("href", url);
  await expect.poll(async () => {
    const pixels = await intro.locator("canvas").evaluate((canvas: HTMLCanvasElement) => ({
      data: Array.from(canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data),
      width: canvas.width, height: canvas.height
    }));
    return jsQR(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height)?.data;
  }).toBe(url);
  const qrBox = await intro.locator("canvas").boundingBox();
  expect(qrBox!.width).toBeGreaterThan(250);
  await testInfo.attach("qr-welcome-desktop", { body: await page.screenshot(), contentType: "image/png" });
  await page.getByRole("button", { name: "Präsentation starten" }).click();
  await expect(intro).toHaveCount(0);
  const link = page.getByRole("link", { name: `Link zur Vorlesung: ${url}`, exact: true });
  await expect(link).toBeVisible();
  const linkBox = await link.boundingBox();
  expect(linkBox!.x).toBeLessThan(40);
  expect(linkBox!.y).toBeLessThan(50);
  await page.getByRole("button", { name: "Vorherige Folie", exact: true }).click();
  await expect(intro).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(intro.locator("canvas")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await testInfo.attach("qr-welcome-mobile", { body: await page.screenshot(), contentType: "image/png" });
  await page.setViewportSize({ width: 1280, height: 720 });

  const other = await browser.newContext();
  try {
    const otherPage = await other.newPage();
    await testLogin(otherPage, "qa-other@learnordie.test");
    const list = await otherPage.request.get("/api/lectures");
    expect((await list.json()).lectures.some((item: { id: string }) => item.id === lecture.id)).toBe(false);
    expect((await otherPage.request.get(`/lecturer/live/${lecture.publicToken}`)).status()).toBe(404);
  } finally { await other.close(); }
  await page.goto("/lecturer");
  // Logout is tested through the application endpoint; new protected navigation must fail.
  await page.goto("/api/auth/logout");
  await page.goto("/lecturer");
  await expect(page).toHaveURL(/\/lecturer\/login$/);
  expect(errors).toEqual([]);
});

test("three fresh student contexts enter by link, persist identity and enforce unique lazy names", async ({ browser }) => {
  const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext()));
  try {
    const pages = await Promise.all(contexts.map((context) => context.newPage()));
    await Promise.all(pages.map(async (page, index) => {
      await page.goto(index === 2 ? "/learn/gleitlagerung-demo" : "/l/gleitlagerung-demo");
      await expect(page.locator("[data-slide-engine=v1]")).toBeVisible();
      await expect(page.getByRole("dialog", { name: /Pseudonym/ })).toHaveCount(0);
      await expect.poll(async () => (await (await page.request.get("/api/student/profile")).json()).profile?.id).toBeTruthy();
    }));
    const keys = await Promise.all(pages.map((page) => page.evaluate(() => localStorage.getItem("lb_student_key"))));
    expect(new Set(keys).size).toBe(3);
    const questionsResponse = await pages[0].request.get("/api/lecture/gleitlagerung-demo/questions");
    expect(questionsResponse.ok()).toBe(true);
    // The fixture's title is stable; this must match server and client slug generation.
    const seriesId = seriesIdFromTitle("Maschinenelemente I");
    await expect.poll(async () => (await (await pages[0].request.get(`/api/student/claim?seriesId=${seriesId}`)).json()).claim?.displayName).toBeTruthy();
    const name = `Nordlicht-${Date.now()}`;
    const claims = await Promise.all(pages.slice(0, 2).map((page) => page.request.post("/api/student/claim", { data: { seriesId, displayName: name } })));
    expect(claims.map((response) => response.status()).sort()).toEqual([200, 409]);
    const winner = claims[0].status() === 200 ? 0 : 1;
    const loser = 1 - winner;
    const collision = await claims[loser].json();
    expect(collision.suggestions.length).toBeGreaterThan(0);
    await pages[winner].reload();
    expect(await pages[winner].evaluate(() => localStorage.getItem("lb_student_key"))).toBe(keys[winner]);
    const claim = await (await pages[winner].request.get(`/api/student/claim?seriesId=${seriesId}`)).json();
    expect(claim.claim.displayName).toBe(name);
  } finally { await Promise.all(contexts.map((context) => context.close())); }
});

test("test login rejects cross-site requests and serializes concurrent password limits", async ({ request }) => {
  test.info().annotations.push({ type: "retry", description: "A retry uses a separate unknown-account bucket; rate-limit assertions remain exact." });
  const email = test.info().retry ? "qa-rate-retry@learnordie.test" : "qa-rate@learnordie.test";
  const rejected = await request.post("/api/auth/test-login", {
    headers: { origin: "https://untrusted.example", "sec-fetch-site": "cross-site" },
    data: { email, password }
  });
  expect(rejected.status()).toBe(403);
  const attempts = await Promise.all(Array.from({ length: 8 }, () => request.post("/api/auth/test-login", {
    data: { email, password: "wrong-password-for-fixture" }
  })));
  expect(attempts.filter((response) => response.status() === 401)).toHaveLength(5);
  expect(attempts.filter((response) => response.status() === 429)).toHaveLength(3);
  const validButBlocked = await request.post("/api/auth/test-login", { data: { email, password } });
  expect(validButBlocked.status()).toBe(429);
  expect(Number(validButBlocked.headers()["retry-after"])).toBeGreaterThan(0);
});
