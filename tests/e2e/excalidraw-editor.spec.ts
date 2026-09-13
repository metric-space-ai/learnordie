import { expect, test, type Locator, type Page } from "@playwright/test";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { crc32, deflateSync } from "node:zlib";
import { originalModelCompanion } from "../../src/lib/model-original-source";
import { toggleStudioPreview } from "./studio-controls";

// These stories run against the real isolated Postgres E2E server. Only its
// explicitly configured, expiring test account is used; no auth/scene mocks.
const testPassword = "e2e-only-test-password-not-for-production";
type NativeElement = {
  id: string;
  type: string;
  text?: string;
  width?: number;
  fontSize?: number;
  fileId?: string;
  isDeleted?: boolean;
  customData?: { learnordie?: { type: string; html?: string; sceneId?: string } };
};
type FixtureLecture = {
  id: string;
  title: string;
  publicToken: string;
  slides: Array<{ id: string }>;
  slideDocument?: { slides: Array<{ id: string; canvas?: { elements: NativeElement[]; files: Record<string, { dataURL: string }> } }> };
};

function diagnostics(page: Page, expectedCspRejection = false) {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (expectedCspRejection && /Content Security Policy|violates.*directive|^Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed and the 'allow-scripts' permission is not set\.$/i.test(message.text())) return;
    problems.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 500) problems.push(`${response.status()} ${response.url()}`);
  });
  return () => expect(problems, "No runtime, console or server errors").toEqual([]);
}

function canvasTestAccount() {
  // At most two stories (four attempts including retries) per identity. Keep
  // the real persistent rate limit intact and do not consume the QR test user.
  const title = test.info().title;
  const group = /native text|one presenter/.test(title) ? 0
    : /native image|original reader/.test(title) ? 1
      : /original companion|HTML\/CSS embeds/.test(title) ? 2 : 3;
  return `qa-canvas-${group}@learnordie.test`;
}

async function login(page: Page, email = canvasTestAccount()) {
  await page.goto("/lecturer/login");
  await page.getByText("Mit Testkonto anmelden", { exact: true }).click();
  await page.getByLabel("Testkonto E-Mail", { exact: true }).fill(email);
  await page.getByLabel("Testkonto Passwort", { exact: true }).fill(testPassword);
  await page.getByRole("button", { name: "Testkonto öffnen", exact: true }).click();
  await expect(page).toHaveURL(/\/lecturer$/);
  await page.reload();
  await expect(page).toHaveURL(/\/lecturer$/);
}

async function createLecture(page: Page, story: string) {
  await login(page);
  const title = `Canvas ${story} ${randomUUID().slice(0, 8)}`;
  const form = page.locator(".new-lecture-composer");
  if (!await form.isVisible()) {
    await page.getByLabel("Studio-Menü", { exact: true }).click();
    await page.getByRole("button", { name: "Neue Vorlesung", exact: true }).click();
  }
  await form.getByLabel("Titel", { exact: true }).fill(title);
  await form.getByLabel("Vorlesungsreihe", { exact: true }).fill(`${title} Reihe`);
  await form.getByLabel("Termin", { exact: true }).fill("2030-10-01T10:00");
  await form.getByLabel("Prüfung", { exact: true }).fill("2030-12-01");
  const created = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/lectures" && response.request().method() === "POST"
  );
  await form.getByRole("button", { name: "Anlegen", exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const { lecture } = await response.json() as { lecture: FixtureLecture };
  expect(lecture.title).toBe(title);
  await nativeEditor(page);
  await expect(page.getByRole("toolbar", { name: "Folienelemente" })).toBeVisible();
  // No duplicate legacy stage or optional second editor behind the canvas.
  await expect(page.locator(".native-studio-editor")).toHaveCount(1);
  await expect(page.locator(".dashboard-slide-preview, [data-slide-field], [data-slide-copy-index]")).toHaveCount(0);
  return lecture;
}

async function nativeEditor(page: Page) {
  const editor = page.getByLabel("Excalidraw-Folieneditor", { exact: true });
  await expect(editor).toHaveAttribute("data-canvas-engine", "excalidraw");
  await expect(editor).toHaveAttribute("data-canvas-ready", "true");
  await expect(editor.locator("canvas.interactive")).toBeVisible();
  return editor;
}

async function selectLecture(page: Page, lecture: FixtureLecture) {
  await page.getByLabel("Studio-Menü", { exact: true }).click();
  await page.getByRole("option").filter({ has: page.getByText(lecture.title, { exact: true }) }).click();
  return nativeEditor(page);
}

async function savedLecture(page: Page, id: string) {
  const response = await page.request.get("/api/lectures");
  expect(response.ok()).toBe(true);
  const { lectures } = await response.json() as { lectures: FixtureLecture[] };
  const lecture = lectures.find((item) => item.id === id);
  expect(lecture, "Own lecture remains in the authenticated list").toBeTruthy();
  return lecture!;
}

async function save(page: Page, lecture: FixtureLecture) {
  const saved = page.waitForResponse((response) =>
    new URL(response.url()).pathname === `/api/lectures/${lecture.id}` && response.request().method() === "PATCH"
  );
  await page.locator(".studio-save-inline").click();
  const response = await saved;
  expect(response.ok()).toBe(true);
  expect(response.request().postDataJSON()).not.toHaveProperty("slides");
  await expect(page.locator(".studio-save-status")).toHaveText("Gespeichert");
  return savedLecture(page, lecture.id);
}

function firstScene(lecture: FixtureLecture) {
  const scene = lecture.slideDocument?.slides[0].canvas;
  expect(scene, "Persistence stores the canonical native canvas, not just legacy blocks").toBeTruthy();
  return scene!;
}

async function viewCanvas(page: Page) {
  const canvas = page.locator('[data-canvas-engine="excalidraw"]');
  await expect(canvas).toHaveAttribute("data-canvas-ready", "true");
  await expect(canvas.locator("canvas").first()).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "Folienelemente" })).toHaveCount(0);
  return canvas;
}

async function doubleClickText(canvas: Locator, point: { x: number; y: number }) {
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await canvas.dblclick({ position: { x: point.x * box!.width, y: point.y * box!.height } });
}

test("native text is edited directly, saved in preview, reloaded and presented to a fresh student", async ({ page, browser }, testInfo) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const clean = diagnostics(page);
  const lecture = await createLecture(page, "Text");
  const editor = await nativeEditor(page);
  await page.getByLabel("Element einfügen", { exact: true }).click();
  await page.getByRole("button", { name: "Text hinzufügen", exact: true }).click();
  await expect(page.locator(".studio-save-status")).toHaveText("Ungespeichert");
  const inserted = firstScene(await save(page, lecture)).elements.find((element) => element.text === "Neuer Text" && !element.isDeleted);
  expect(inserted).toBeTruthy();
  const measuredWidth = await page.evaluate(async () => {
    await document.fonts.load('32px "Excalifont"', "Neuer Text");
    const context = document.createElement("canvas").getContext("2d")!;
    context.font = '32px "Excalifont"';
    return context.measureText("Neuer Text").width;
  });
  expect(inserted!.width!, "Saved text bounds fit the loaded drawing font, not fallback metrics").toBeGreaterThanOrEqual(measuredWidth - 1);
  const canvas = editor.locator("canvas.interactive");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const initialText = `Native Notiz ${randomUUID().slice(0, 8)}`;
  const revisedText = `${initialText} überarbeitet`;
  // Use the native text tool for arbitrary placement; the app's Text hinzufügen
  // action inserts a ready-to-edit text element at the viewport center.
  await editor.locator("label").filter({ has: page.getByRole("radio", { name: "Text", exact: true }) }).click();
  await canvas.click({ position: { x: box!.width * 0.3, y: box!.height * 0.72 } });
  const input = page.locator("textarea.excalidraw-wysiwyg");
  await expect(input).toBeVisible();
  await input.fill(initialText);
  const inputBox = await input.boundingBox();
  expect(inputBox).not.toBeNull();
  const point = {
    x: (inputBox!.x + Math.min(12, inputBox!.width / 2) - box!.x) / box!.width,
    y: (inputBox!.y + inputBox!.height / 2 - box!.y) / box!.height
  };
  await input.press("Escape");
  await expect(input).toHaveCount(0);
  await doubleClickText(canvas, point);
  await expect(input).toHaveValue(initialText);
  await input.fill(revisedText);
  // Text-editing keys belong to the native editor, not slide navigation.
  await input.press("ArrowRight");
  await expect(page.getByRole("combobox", { name: "Folie auswählen", exact: true })).toHaveValue("0");
  await input.press("Escape");
  await expect(page.locator(".studio-save-status")).toHaveText("Ungespeichert");
  await toggleStudioPreview(page);
  await viewCanvas(page);
  const saved = await save(page, lecture);
  const textElement = firstScene(saved).elements.find((element) => !element.isDeleted && element.type === "text" && element.text === revisedText);
  expect(textElement, "A real native text element was persisted").toBeTruthy();
  await page.reload();
  const reloaded = await selectLecture(page, lecture);
  await doubleClickText(reloaded.locator("canvas.interactive"), point);
  await expect(input).toHaveValue(revisedText);
  await input.press("Escape");
  await testInfo.attach("native-text-after-reload", { body: await page.screenshot(), contentType: "image/png" });
  await page.getByRole("button", { name: "Nächste Folie", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Folie auswählen", exact: true })).toHaveValue("1");
  await page.getByRole("button", { name: "Vorherige Folie", exact: true }).click();
  await nativeEditor(page);

  const studentContext = await browser.newContext();
  const otherContext = await browser.newContext();
  let liveStarted = false;
  try {
    const student = await studentContext.newPage();
    const studentClean = diagnostics(student);
    await page.getByRole("link", { name: /Präsentieren/ }).click();
    await expect(page.getByRole("region", { name: "Vorlesung beitreten" })).toBeVisible();
    liveStarted = true;
    await student.goto(`/l/${lecture.publicToken}`);
    await expect(student.getByRole("region", { name: "Vorlesung beitreten" })).toBeVisible();
    await page.getByRole("button", { name: "Präsentation starten", exact: true }).click();
    await viewCanvas(page);
    await viewCanvas(student);
    await expect(student.getByRole("region", { name: "Folieninhalt als Text" })).toContainText(revisedText);
    await expect(student.getByRole("dialog", { name: /Pseudonym/ })).toHaveCount(0);
    await student.reload();
    await viewCanvas(student);
    await expect(student.getByRole("region", { name: "Folieninhalt als Text" })).toContainText(revisedText);
    await expect(student.locator(".slide-lecture-link")).toHaveAttribute("href", new RegExp(`/l/${lecture.publicToken}$`));
    await testInfo.attach("native-student-after-reload", { body: await student.screenshot(), contentType: "image/png" });
    const other = await otherContext.newPage();
    await login(other, "qa-other@learnordie.test");
    await expect(other.getByRole("option").filter({ hasText: lecture.title })).toHaveCount(0);
    const otherList = await other.request.get("/api/lectures");
    expect(otherList.ok()).toBe(true);
    expect((await otherList.json()).lectures.some((item: { id: string }) => item.id === lecture.id)).toBe(false);
    expect((await other.request.get(`/lecturer/live/${lecture.publicToken}`)).status()).toBe(404);
    const otherCsrf = await other.locator("[data-csrf-token]").getAttribute("data-csrf-token");
    expect(otherCsrf).toBeTruthy();
    const denied = await other.request.patch(`/api/lectures/${lecture.id}`, {
      headers: { "x-learnbuddy-csrf": otherCsrf! }, data: { title: "Forbidden cross-owner change" }
    });
    expect(denied.status(), "A valid session and its own CSRF token cannot edit another lecturer's document").toBe(404);
    expect((await savedLecture(page, lecture.id)).title).toBe(lecture.title);
    studentClean();
  } finally {
    try {
      if (liveStarted) {
        await page.getByLabel("Präsentationssteuerung", { exact: true }).click();
        await page.getByRole("button", { name: "Beenden", exact: true }).click();
        await expect(page).toHaveURL(/\/lecturer$/);
      }
    } finally {
      await Promise.all([studentContext.close(), otherContext.close()]);
    }
  }
  await page.getByLabel("Studio-Menü", { exact: true }).click();
  await page.getByRole("link", { name: "Abmelden", exact: true }).click();
  await page.goto("/lecturer");
  await expect(page).toHaveURL(/\/lecturer\/login$/);
  await page.reload();
  await expect(page).toHaveURL(/\/lecturer\/login$/);
  clean();
});

test("one presenter synchronizes three independent guests, timed questions and session scores", async ({ page, browser }, testInfo) => {
  test.setTimeout(150_000);
  const lecture = await createLecture(page, "Three guests");
  const contexts = [];
  const students: Page[] = [];
  const clean = [diagnostics(page)];
  let presenting = false;
  const controls = async () => {
    if (!await page.locator(".presentation-controls").evaluate((node) => (node as HTMLDetailsElement).open)) {
      await page.getByLabel("Präsentationssteuerung", { exact: true }).click();
    }
  };
  try {
    for (let i = 0; i < 3; i++) {
      const context = await browser.newContext();
      contexts.push(context);
      const student = await context.newPage();
      students.push(student);
      clean.push(diagnostics(student));
    }
    await page.getByRole("link", { name: /Präsentieren/ }).click();
    presenting = true;
    await expect(page.getByRole("region", { name: "Vorlesung beitreten" })).toBeVisible();
    for (const student of students) {
      await student.goto(`/l/${lecture.publicToken}`);
      await expect(student.getByRole("region", { name: "Vorlesung beitreten" })).toBeVisible();
      await expect(student.getByRole("dialog", { name: /Pseudonym/ })).toHaveCount(0);
    }
    await page.getByRole("button", { name: "Präsentation starten", exact: true }).click();
    for (const student of students) await viewCanvas(student);
    await expect(page.locator("header:visible, footer:visible")).toHaveCount(0);
    const identities = await Promise.all(contexts.map(async (context) => (await context.cookies()).find((cookie) => cookie.name === "lb_student_key")?.value));
    expect(identities.every(Boolean)).toBe(true);
    expect(new Set(identities).size).toBe(3);

    await controls();
    await page.getByRole("button", { name: "Nächste Folie", exact: true }).click();
    for (const student of students) {
      await expect(student.getByRole("region", { name: "Folieninhalt als Text" })).toContainText("Sommerfeldzahl");
    }
    await students[2].reload();
    await expect(students[2].getByRole("region", { name: "Folieninhalt als Text" })).toContainText("Sommerfeldzahl");
    await page.getByRole("button", { name: "Vorherige Folie", exact: true }).click();
    await page.getByLabel("Fragezeit", { exact: true }).selectOption("30");
    await page.getByLabel("Vorbereitete Frage", { exact: true }).click();
    for (const student of students) {
      await expect(student.getByLabel("Quizfrage", { exact: true })).toBeVisible();
      await student.getByRole("button", { name: /Es treten gleichzeitig Schmierfilmanteile/ }).click();
      await expect(student.locator(".question-feedback")).toContainText("Richtig · 3 Punkte");
    }
    await page.getByLabel("Vorbereitete Frage", { exact: true }).click();
    for (const [i, student] of students.entries()) {
      await expect(student.getByLabel("Quizfrage", { exact: true })).toHaveCount(0);
      await student.getByLabel("Eigenes Pseudonym", { exact: true }).fill(`Guest ${lecture.id.slice(0, 6)} ${i + 1}`);
      await student.getByRole("button", { name: "Sichern", exact: true }).click();
      await expect(student.getByText("Pseudonym gesichert", { exact: true })).toBeVisible();
    }
    // A fresh, unanswered round must disappear on all clients without a close command.
    await page.getByLabel("Fragezeit", { exact: true }).selectOption("5");
    await page.getByLabel("Vorbereitete Frage", { exact: true }).click();
    await Promise.all(students.map((student) => expect(student.getByLabel("Quizfrage", { exact: true })).toBeVisible()));
    await Promise.all(students.map((student) => expect(student.getByLabel("Quizfrage", { exact: true })).toHaveCount(0, { timeout: 7_000 })));
    for (const [i, student] of students.entries()) {
      await student.getByRole("button", { name: "Rangliste", exact: true }).click();
      await expect(student.locator(".leader-row.self")).toContainText(`Guest ${lecture.id.slice(0, 6)} ${i + 1}`);
      await expect(student.locator(".leader-row.self")).toContainText("3");
      await expect(student.locator(".leader-row")).toHaveCount(3);
      const scoreboard = student.getByLabel("Rangliste", { exact: true });
      await expect(scoreboard).toHaveCSS("animation-name", "app-panel-enter");
      await scoreboard.evaluate(async (element) => { await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)); });
      await expect(scoreboard).toHaveCSS("opacity", "1");
      await expect(scoreboard).toHaveCSS("clip-path", "none");
      await testInfo.attach(`live-guest-${i + 1}-score`, { body: await student.screenshot({ animations: "disabled" }), contentType: "image/png" });
    }
    await page.getByRole("button", { name: "Rangliste", exact: true }).click();
    await expect(page.locator(".leader-row")).toHaveCount(3);
    for (const assertClean of clean) assertClean();
  } finally {
    try {
      if (presenting) {
        // Close an open scoreboard so it cannot intercept the presenter action.
        const close = page.getByRole("button", { name: "Rangliste schließen", exact: true });
        if (await close.isVisible()) await close.click();
        await controls();
        await page.getByRole("button", { name: "Beenden", exact: true }).click();
        await expect(page).toHaveURL(/\/lecturer$/);
      }
    } finally {
      for (const context of contexts) await context.close();
    }
  }
});

function nativePngFixture() {
  const chunk = (type: string, data: Buffer) => {
    const tagged = Buffer.concat([Buffer.from(type), data]);
    const size = Buffer.alloc(4), checksum = Buffer.alloc(4);
    size.writeUInt32BE(data.length);
    checksum.writeUInt32BE(crc32(tagged));
    return Buffer.concat([size, tagged, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(32, 0); header.writeUInt32BE(32, 4);
  header[8] = 8; header[9] = 6; // 8-bit RGBA, standard non-interlaced PNG.
  const scanlines = Buffer.alloc(32 * (1 + 32 * 4));
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const offset = y * 129 + 1 + x * 4;
    scanlines.set([105, 101, 219, 255], offset);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(scanlines)), chunk("IEND", Buffer.alloc(0))]);
}

test("native image import persists a real PNG and rejects invalid image bytes without data loss", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  // Chromium's native File System Access picker rejects Playwright's file
  // chooser interception. Exercise the supported standard file-input path,
  // with real bytes and the real Excalidraw decoder (no image/API mocks).
  await page.addInitScript(() => { Reflect.deleteProperty(window, "showOpenFilePicker"); });
  const lecture = await createLecture(page, "Image import");
  const editor = await nativeEditor(page);
  const png = nativePngFixture();
  const chooser = page.waitForEvent("filechooser");
  await editor.locator("label").filter({ has: page.getByRole("radio", { name: "Bild einfügen", exact: true }) }).click();
  await (await chooser).setFiles({ name: "native-image.png", mimeType: "image/png", buffer: png });
  await editor.locator("canvas.interactive").click({ position: { x: 320, y: 240 } });
  await expect(page.locator(".studio-save-status")).toHaveText("Ungespeichert");
  const saved = firstScene(await save(page, lecture));
  const image = saved.elements.find((element) => element.type === "image" && !element.isDeleted);
  expect(image?.fileId).toBeTruthy();
  expect(saved.files[image!.fileId!].dataURL).toMatch(/^data:image\/png;base64,/);
  await page.reload();
  const reloaded = await selectLecture(page, lecture);
  expect(firstScene(await savedLecture(page, lecture.id))).toEqual(saved);
  const badChooser = page.waitForEvent("filechooser");
  await reloaded.locator("label").filter({ has: page.getByRole("radio", { name: "Bild einfügen", exact: true }) }).click();
  await (await badChooser).setFiles({ name: "invalid.png", mimeType: "image/png", buffer: Buffer.from("This is not an image") });
  await expect(page.getByText(/Das Bild konnte nicht eingefügt werden|Ungültige Datei konnte nicht geladen werden|Nicht unterstützter Dateityp/)).toBeVisible();
  expect(firstScene(await savedLecture(page, lecture.id))).toEqual(saved);
  await testInfo.attach("native-invalid-image-rejected", { body: await page.screenshot(), contentType: "image/png" });
  await page.reload();
  await selectLecture(page, lecture);
  expect(firstScene(await savedLecture(page, lecture.id))).toEqual(saved);
});

test("original reader renders the complete handout with native formulas, tables and working anchors", async ({ page }, testInfo) => {
  await page.goto("/lecturer/model-original");
  await expect(page).toHaveURL(/\/lecturer\/login$/);
  await login(page);
  const clean = diagnostics(page);
  await page.goto("/api/lectures/model-demo/source?view=read");
  await expect(page).toHaveURL(/\/lecturer\/model-original$/);
  const handout = page.getByRole("article", { name: "Vollständiges Begleitskript", exact: true });
  await expect(handout).toContainText("F.5 Reichweite der Unterlage");
  await expect(handout.locator(".katex-error")).toHaveCount(0);
  await expect(handout.locator('math[display="block"]')).toHaveCount(61);
  expect(await handout.locator("table").count()).toBeGreaterThan(0);
  const missingAnchors = await handout.locator('a[href^="#"]').evaluateAll((links) => links.map((link) => link.getAttribute("href")!).filter((href) => !document.getElementById(decodeURIComponent(href.slice(1)))));
  expect(missingAnchors).toEqual([]);
  await page.getByText("Originalnotizen der acht Folien", { exact: true }).click();
  for (let i = 1; i <= 8; i++) await expect(page.locator(`#slide-${i}`)).toBeVisible();
  await page.getByText("Originalnotizen der acht Folien", { exact: true }).click();
  await handout.locator('math[display="block"]').first().scrollIntoViewIfNeeded();
  await testInfo.attach("original-handout-formulas", { body: await page.screenshot(), contentType: "image/png" });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  const themeToggle = page.getByRole("button", { name: "Dunkles Design", exact: true });
  await expect(themeToggle).toHaveCount(1);
  await expect(themeToggle).toHaveCSS("position", "static");
  await testInfo.attach("original-handout-mobile", { body: await page.screenshot(), contentType: "image/png" });
  clean();
});

test("the original companion downloads through the browser without changing a byte", async ({ page }) => {
  await login(page);
  // This account intentionally owns no lectures: the reader/download must
  // also work before creating a lecture, when there is no studio header yet.
  await page.goto("/api/lectures/model-demo/source?view=read");
  const downloaded = page.waitForEvent("download");
  await page.getByRole("link", { name: "Markdown-Original herunterladen", exact: true }).click();
  const download = await downloaded;
  expect(download.suggestedFilename()).toBe("Modellbegriff-Vorlesungsunterlage.md");
  expect(await download.failure()).toBeNull();
  const file = await download.path();
  expect(file).toBeTruthy();
  const content = await readFile(file!);
  expect(createHash("sha256").update(content).digest("hex")).toBe(createHash("sha256").update(originalModelCompanion).digest("hex"));
});

test("HTML/CSS embeds persist but scripts, parent DOM access, forms and external requests do not", async ({ page, browser }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const clean = diagnostics(page, true);
  const lecture = await createLecture(page, "HTML");
  const attempts: string[] = [];
  const sentinel = "https://excalidraw-qa.invalid";
  page.on("request", (request) => { if (request.url().startsWith(sentinel)) attempts.push(request.url()); });
  const html = `<style>.native-probe { color: rgb(12,34,56); }</style>
    <h2>Native HTML Probe</h2><p class="native-probe">HTML und CSS bleiben lesbar.</p>
    <script>parent.document.documentElement.dataset.canvasEscape="yes";fetch("${sentinel}/script")</script>
    <img src="${sentinel}/pixel" onerror="parent.document.documentElement.dataset.canvasEscape='yes'">
    <form action="${sentinel}/form"><button>Verbotenes Formular</button></form>
    <a href="javascript:parent.document.documentElement.dataset.canvasEscape='yes'">Ausbruch</a>
    <iframe src="${sentinel}/frame"></iframe><meta http-equiv="refresh" content="0;url=${sentinel}/navigate">`;
  await page.getByLabel("Element einfügen", { exact: true }).click();
  await page.getByRole("toolbar", { name: "Folienelemente" }).getByRole("button", { name: "HTML", exact: true }).click();
  await page.getByRole("textbox", { name: "HTML und CSS", exact: true }).fill(html);
  await page.getByRole("button", { name: "HTML einfügen", exact: true }).click();
  // The element must render in the editor immediately, not only after a
  // preview remount repairs missing native defaults.
  await expect(page.locator("iframe.learnordie-canvas-html")).toBeVisible();
  await expect(page.frameLocator("iframe.learnordie-canvas-html").getByRole("heading", { name: "Native HTML Probe" })).toBeVisible();
  await toggleStudioPreview(page);
  await viewCanvas(page);
  const assertHtml = async (target: Page) => {
    const iframe = target.locator("iframe.learnordie-canvas-html");
    await expect(iframe).toHaveAttribute("sandbox", "");
    const content = target.frameLocator("iframe.learnordie-canvas-html");
    await expect(content.getByRole("heading", { name: "Native HTML Probe" })).toBeVisible();
    await expect(content.locator(".native-probe")).toHaveCSS("color", "rgb(12, 34, 56)");
    await expect(content.locator("script, form, iframe, a[href], [onerror], meta[http-equiv=refresh]")).toHaveCount(0);
    expect(await target.evaluate(() => document.documentElement.dataset.canvasEscape)).toBeUndefined();
  };
  await assertHtml(page);
  const saved = await save(page, lecture);
  expect(firstScene(saved).elements).toEqual(expect.arrayContaining([expect.objectContaining({
    type: "embeddable", customData: expect.objectContaining({ learnordie: expect.objectContaining({ type: "html", html }) })
  })]));
  await page.reload();
  await selectLecture(page, lecture);
  await toggleStudioPreview(page);
  await assertHtml(page);
  await testInfo.attach("native-html-isolated", { body: await page.screenshot(), contentType: "image/png" });
  const context = await browser.newContext();
  try {
    const student = await context.newPage();
    student.on("request", (request) => { if (request.url().startsWith(sentinel)) attempts.push(request.url()); });
    const studentClean = diagnostics(student, true);
    await student.goto(`/learn/${lecture.publicToken}`);
    await viewCanvas(student);
    await assertHtml(student);
    await student.reload();
    await assertHtml(student);
    studentClean();
  } finally { await context.close(); }
  expect(attempts, "No author-controlled network/navigation escapes").toEqual([]);
  clean();
});

test("three.js embeds are real WebGL, independently interactive and survive save/reload", async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const clean = diagnostics(page);
  const lecture = await createLecture(page, "Three");
  await page.getByLabel("Element einfügen", { exact: true }).click();
  await page.getByRole("toolbar", { name: "Folienelemente" }).getByRole("button", { name: "3D-Szene", exact: true }).click();
  await page.getByLabel("3D-Szene auswählen", { exact: true }).selectOption("modell.morph");
  await page.getByRole("button", { name: "3D-Szene einfügen", exact: true }).click();
  await expect(page.locator('.learnordie-canvas-scene [data-scene-id="modell.morph"] canvas')).toBeVisible();
  await toggleStudioPreview(page);
  await viewCanvas(page);
  const scene = page.locator('.learnordie-canvas-scene [data-scene-id="modell.morph"]');
  await expect(scene).toHaveAttribute("data-scene-mode", "live");
  const glCanvas = scene.locator("canvas");
  await expect(glCanvas).toBeVisible();
  expect(await glCanvas.evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    return Boolean(context && !context.isContextLost() && context.drawingBufferWidth > 0 && context.drawingBufferHeight > 0);
  })).toBe(true);
  const slider = scene.getByRole("slider", { name: "Begriff", exact: true });
  await slider.focus();
  await slider.press("Home");
  await expect(slider).toHaveValue("0");
  await slider.press("End");
  await expect(slider).toHaveValue("4");
  await expect(page.getByRole("combobox", { name: "Folie auswählen", exact: true })).toHaveValue("0");
  await scene.getByRole("button", { name: "3D-Blick zurücksetzen", exact: true }).click();
  const saved = await save(page, lecture);
  expect(firstScene(saved).elements).toEqual(expect.arrayContaining([expect.objectContaining({
    type: "embeddable", customData: expect.objectContaining({ learnordie: expect.objectContaining({ type: "scene3d", sceneId: "modell.morph" }) })
  })]));
  await page.reload();
  await selectLecture(page, lecture);
  await toggleStudioPreview(page);
  await expect(scene).toHaveAttribute("data-scene-mode", "live");
  await expect(scene.locator("canvas")).toBeVisible();
  await testInfo.attach("native-three-webgl-after-reload", { body: await page.screenshot(), contentType: "image/png" });
  clean();
});
