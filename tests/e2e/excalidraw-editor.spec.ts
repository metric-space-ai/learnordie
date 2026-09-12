import { expect, test, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

// These stories run against the real isolated Postgres E2E server. Only its
// explicitly configured, expiring test account is used; no auth/scene mocks.
const testPassword = "e2e-only-test-password-not-for-production";
type NativeElement = {
  id: string;
  type: string;
  text?: string;
  isDeleted?: boolean;
  customData?: { learnordie?: { type: string; html?: string; sceneId?: string } };
};
type FixtureLecture = {
  id: string;
  title: string;
  publicToken: string;
  slides: Array<{ id: string }>;
  slideDocument?: { slides: Array<{ id: string; canvas?: { elements: NativeElement[] } }> };
};

function diagnostics(page: Page, expectedCspRejection = false) {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (expectedCspRejection && /Content Security Policy|violates.*directive/i.test(message.text())) return;
    problems.push(message.text());
  });
  page.on("response", (response) => {
    if (response.status() >= 500) problems.push(`${response.status()} ${response.url()}`);
  });
  return () => expect(problems, "No runtime, console or server errors").toEqual([]);
}

async function login(page: Page, email = "qa-qr@learnordie.test") {
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
  const canvas = editor.locator("canvas.interactive");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const initialText = `Native Notiz ${randomUUID().slice(0, 8)}`;
  const revisedText = `${initialText} überarbeitet`;
  // Use the native text tool for arbitrary placement; the app's Text hinzufügen
  // action inserts a ready-to-edit text element at the viewport center.
  await editor.getByRole("radio", { name: "Text", exact: true }).click();
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
  await expect(page.locator(".studio-stepper span")).toHaveText(`1 / ${lecture.slides.length}`);
  await input.press("Escape");
  await expect(page.locator(".studio-save-status")).toHaveText("Ungespeichert");
  await page.getByRole("button", { name: "Vorschau", exact: true }).click();
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
  await expect(page.locator(".studio-stepper span")).toHaveText(`2 / ${lecture.slides.length}`);
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
    expect((await other.request.get(`/lecturer/live/${lecture.publicToken}`)).status()).toBe(404);
    studentClean();
  } finally {
    try {
      if (liveStarted) {
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
  await page.getByRole("toolbar", { name: "Folienelemente" }).getByRole("button", { name: "HTML", exact: true }).click();
  await page.getByRole("textbox", { name: "HTML und CSS", exact: true }).fill(html);
  await page.getByRole("button", { name: "HTML einfügen", exact: true }).click();
  await page.getByRole("button", { name: "Vorschau", exact: true }).click();
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
  await page.getByRole("button", { name: "Vorschau", exact: true }).click();
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
  await page.getByRole("toolbar", { name: "Folienelemente" }).getByRole("button", { name: "3D-Szene", exact: true }).click();
  await page.getByLabel("3D-Szene auswählen", { exact: true }).selectOption("modell.morph");
  await page.getByRole("button", { name: "3D-Szene einfügen", exact: true }).click();
  await page.getByRole("button", { name: "Vorschau", exact: true }).click();
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
  await expect(page.locator(".studio-stepper span")).toHaveText(`1 / ${lecture.slides.length}`);
  await scene.getByRole("button", { name: "3D-Blick zurücksetzen", exact: true }).click();
  const saved = await save(page, lecture);
  expect(firstScene(saved).elements).toEqual(expect.arrayContaining([expect.objectContaining({
    type: "embeddable", customData: expect.objectContaining({ learnordie: expect.objectContaining({ type: "scene3d", sceneId: "modell.morph" }) })
  })]));
  await page.reload();
  await selectLecture(page, lecture);
  await page.getByRole("button", { name: "Vorschau", exact: true }).click();
  await expect(scene).toHaveAttribute("data-scene-mode", "live");
  await expect(scene.locator("canvas")).toBeVisible();
  await testInfo.attach("native-three-webgl-after-reload", { body: await page.screenshot(), contentType: "image/png" });
  clean();
});
