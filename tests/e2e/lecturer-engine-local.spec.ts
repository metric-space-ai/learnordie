import { expect, type Page, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { openStudioActions, toggleStudioPreview } from "./studio-controls";

// Native text/double-click, HTML sandbox and WebGL user stories are covered in
// excalidraw-editor.spec.ts. These complementary stories retain the actual
// material, AI and document-metadata workflows around the new primary editor.
type LectureApi = {
  id: string;
  title: string;
  slideDocument: {
    slides: Array<{
      id: string;
      blocks: Array<{ id: string; type: string }>;
      canvas?: { elements: Array<{ id: string; type: string; text?: string; isDeleted?: boolean }> };
      quizAnchors?: Array<{ id: string; level: string; blockId: string; label?: string }>;
    }>;
    assets: Array<{ id: string; title: string }>;
  };
  presentationAssets?: Array<{ id: string; kind: string; extractedText?: string }>;
  questionReviews?: Array<{ id: string }>;
};

function diagnostics(page: Page) {
  const problems: string[] = [];
  page.on("pageerror", (error) => problems.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") problems.push(message.text()); });
  page.on("response", (response) => { if (response.status() >= 500) problems.push(`${response.status()} ${response.url()}`); });
  return () => expect(problems).toEqual([]);
}

async function openStudioTool(page: Page, name: "Assistent" | "Fragen" | "Quellen") {
  await openStudioActions(page);
  await page.getByRole("button", { name: "Folienwerkzeuge öffnen", exact: true }).click();
  await page.getByLabel("Folienwerkzeuge", { exact: true }).getByRole("button", { name: new RegExp(`^${name}`) }).click();
}

async function fixture(page: Page) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const nonce = randomUUID().slice(0, 8);
  await page.goto("/lecturer/login");
  await page.getByLabel("E-Mail", { exact: true }).fill(`native-studio-${nonce}@example.test`);
  await page.getByRole("button", { name: "Code senden", exact: true }).click();
  const link = page.getByRole("link", { name: "Direkt zum Dozentenbereich", exact: true });
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/lecturer$/);
  await page.reload();
  await expect(page).toHaveURL(/\/lecturer$/);
  const form = page.locator(".new-lecture-composer");
  await expect(form).toBeVisible();
  await form.getByLabel("Titel", { exact: true }).fill(`Native Studio ${nonce}`);
  await form.getByLabel("Vorlesungsreihe", { exact: true }).fill(`Gleitlagerung ${nonce}`);
  await form.getByLabel("Termin", { exact: true }).fill("2030-10-01T10:00");
  await form.getByLabel("Prüfung", { exact: true }).fill("2030-12-01");
  const creation = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/lectures" && response.request().method() === "POST");
  await form.getByRole("button", { name: "Anlegen", exact: true }).click();
  const response = await creation;
  expect(response.status()).toBe(201);
  const { lecture } = await response.json() as { lecture: LectureApi };
  await expect(page.getByLabel("Excalidraw-Folieneditor", { exact: true })).toHaveAttribute("data-canvas-ready", "true");
  const csrf = await page.locator("[data-csrf-token]").getAttribute("data-csrf-token");
  expect(csrf).toBeTruthy();
  return { lecture, csrf: csrf! };
}

async function readLecture(page: Page, id: string) {
  const response = await page.request.get("/api/lectures");
  expect(response.ok()).toBe(true);
  const { lectures } = await response.json() as { lectures: LectureApi[] };
  const lecture = lectures.find((item) => item.id === id);
  expect(lecture).toBeTruthy();
  return lecture!;
}

async function save(page: Page, id: string) {
  const saved = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/lectures/${id}` && response.request().method() === "PATCH");
  await page.locator(".studio-save-inline").click();
  const response = await saved;
  expect(response.ok()).toBe(true);
  expect(response.request().postDataJSON()).not.toHaveProperty("slides");
  await expect(page.locator(".studio-save-status")).toHaveText("Gespeichert");
  return readLecture(page, id);
}

async function addNativeText(page: Page, text: string) {
  const editor = page.getByLabel("Excalidraw-Folieneditor", { exact: true });
  await expect(editor).toHaveAttribute("data-canvas-ready", "true");
  await editor.locator("label").filter({ has: page.getByRole("radio", { name: "Text", exact: true }) }).click();
  const canvas = editor.locator("canvas.interactive");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await canvas.click({ position: { x: box!.width * 0.3, y: box!.height * 0.72 } });
  const textarea = page.locator("textarea.excalidraw-wysiwyg");
  await expect(textarea).toBeVisible();
  await textarea.fill(text);
  await textarea.press("Escape");
  await expect(page.locator(".studio-save-status")).toHaveText("Ungespeichert");
}

test("Native Studio preserves canonical text and quiz anchors through preview and metadata saves", async ({ page }) => {
  const clean = diagnostics(page);
  const { lecture, csrf } = await fixture(page);
  const note = `Canvas bleibt maßgeblich ${randomUUID().slice(0, 8)}: ${"Ausführliche native Erklärung zur Mischreibung. ".repeat(8)}`;
  expect(note.length).toBeGreaterThan(240);
  await addNativeText(page, note);
  const firstSave = await save(page, lecture.id);
  const scene = firstSave.slideDocument.slides[0].canvas;
  expect(scene?.elements).toEqual(expect.arrayContaining([expect.objectContaining({ type: "text", text: note })]));

  // Quiz anchors are document metadata, not replacements for native content.
  // Establish real persisted metadata through the owner-authenticated API, then
  // prove a normal dashboard save does not silently discard it or the canvas.
  const document = structuredClone(firstSave.slideDocument);
  const slide = document.slides[0];
  const anchor = { id: `native-anchor-${randomUUID()}`, level: "1.0", blockId: slide.blocks[0].id, label: "Begriffsfrage" };
  slide.quizAnchors = [...(slide.quizAnchors ?? []), anchor];
  const metadata = await page.request.patch(`/api/lectures/${lecture.id}`, {
    headers: { "x-learnbuddy-csrf": csrf }, data: { slideDocument: document }
  });
  expect(metadata.ok()).toBe(true);
  await page.reload();
  await expect(page.getByLabel("Excalidraw-Folieneditor", { exact: true })).toHaveAttribute("data-canvas-ready", "true");
  await toggleStudioPreview(page);
  await expect(page.getByRole("toolbar", { name: "Folienelemente" })).toHaveCount(0);
  await expect(page.locator('[data-canvas-engine="excalidraw"]')).toHaveAttribute("data-canvas-ready", "true");
  const secondSave = await save(page, lecture.id);
  expect(secondSave.slideDocument.slides[0].canvas).toEqual(scene);
  expect(secondSave.slideDocument.slides[0].quizAnchors).toContainEqual(anchor);
  await toggleStudioPreview(page, "Bearbeiten");
  await expect(page.getByRole("toolbar", { name: "Folienelemente" })).toBeVisible();
  clean();
});

test("Pi block edits fail clearly on a canonical canvas; the surrounding planning assistant still works", async ({ page }) => {
  test.setTimeout(120_000);
  const clean = diagnostics(page);
  const { lecture, csrf } = await fixture(page);
  await addNativeText(page, "Nicht durch einen alten KI-Blockpatch ersetzen");
  const before = await save(page, lecture.id);

  // The old context-menu block editor was removed. Exercise its still-existing
  // real API contract, which must reject obsolete block mutations explicitly.
  const response = await page.request.post(`/api/lectures/${lecture.id}/agent-threads`, {
    headers: { "x-learnbuddy-csrf": csrf },
    data: { mode: "studio_slide_edit", slideId: before.slideDocument.slides[0].id, prompt: "Formuliere den Folientext zur Mischreibung präziser." }
  });
  expect(response.ok()).toBe(true);
  const { thread } = await response.json() as { thread: { status: string; error?: string; reviewPatch?: unknown; messages: Array<{ content: string }> } };
  expect(thread.status).toBe("failed");
  expect(JSON.stringify(thread)).toContain("edit.canvas_authoritative");
  expect(thread.messages.map((message) => message.content).join(" ")).toMatch(/native scene|Excalidraw/i);
  expect(thread.reviewPatch ?? null).toBeNull();
  expect((await readLecture(page, lecture.id)).slideDocument).toEqual(before.slideDocument);
  await page.reload();
  await expect(page.getByLabel("Excalidraw-Folieneditor", { exact: true })).toHaveAttribute("data-canvas-ready", "true");

  await openStudioTool(page, "Assistent");
  const assistant = page.getByLabel("Planungsassistent direkt an der Folie", { exact: true });
  await assistant.getByRole("textbox", { name: "Nachricht an den Planungsassistenten", exact: true }).fill("Erkläre die Mischreibung beim Anlauf und schlage eine Frage zur Gleitlagerung vor.");
  await assistant.getByRole("button", { name: "Senden", exact: true }).click();
  await expect(assistant.locator('.assistant-message.assistant[data-ai-provider-used="true"]')).toBeVisible();
  await expect(assistant.locator(".assistant-message.assistant")).toContainText(/Gleitlager|Mischreibung|Schmier/i);
  await assistant.getByRole("button", { name: /Als Quelle speichern/ }).click();
  await expect(page.getByLabel("Quellen direkt an der Folie", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Hinterlegte Quellen", { exact: true })).toContainText("Assistent");
  expect((await readLecture(page, lecture.id)).slideDocument.slides[0].canvas).toEqual(before.slideDocument.slides[0].canvas);
  await page.reload();
  await openStudioTool(page, "Assistent");
  await expect(page.locator(".assistant-message.assistant")).toContainText(/Gleitlager|Mischreibung|Schmier/i);
  clean();
});

test("Material extraction, question generation and HTML formula/table editing remain usable beside the native canvas", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const clean = diagnostics(page);
  const { lecture } = await fixture(page);
  const nonce = randomUUID().slice(0, 8);
  await addNativeText(page, `Eigene Erklärung ${nonce}`);
  const before = await save(page, lecture.id);
  await openStudioTool(page, "Quellen");
  const sources = page.getByLabel("Quellen direkt an der Folie", { exact: true });
  await sources.getByRole("button", { name: "Notiz", exact: true }).click();
  const notes = `Stribeck-Diagramm ${nonce}: Diagramm der Stribeck-Kurve mit Mischreibung, hydrodynamischer Gleitlagerung und Sommerfeldzahl.`;
  await sources.getByRole("textbox", { name: "Notiz", exact: true }).fill(notes);
  await sources.getByRole("button", { name: "Notiz hinzufügen", exact: true }).click();
  await expect(sources.getByText("Quelle hinzugefügt.", { exact: true })).toBeVisible();
  await sources.getByRole("button", { name: "Fragen aktualisieren", exact: true }).click();
  await expect(sources.getByLabel("Letzte Materialverarbeitung", { exact: true })).toContainText("Abgeschlossen");
  await expect(sources.getByLabel("Erkannte Inhalte", { exact: true })).toContainText("Diagramm");
  await expect(sources.getByLabel("Erkannte Inhalte", { exact: true })).toContainText(nonce);
  const processed = await readLecture(page, lecture.id);
  expect(processed.presentationAssets?.some((asset) => asset.kind === "diagram" && asset.extractedText?.includes(nonce))).toBe(true);
  expect(processed.questionReviews?.length).toBeGreaterThan(0);
  expect(processed.slideDocument.slides[0].canvas).toEqual(before.slideDocument.slides[0].canvas);
  await page.getByLabel("Quellen schließen", { exact: true }).click();
  await openStudioTool(page, "Fragen");
  await expect(page.getByLabel("Fragen direkt auf der Folie", { exact: true })).toBeVisible();
  await expect(page.locator(".review-live-title")).not.toBeEmpty();
  await page.getByLabel("Fragen schließen", { exact: true }).click();

  // Formulas/tables now use native embedded HTML instead of the retired block
  // inspector; ordinary slide text above was edited with the real Text tool.
  await page.getByLabel("Element einfügen", { exact: true }).click();
  await page.getByRole("toolbar", { name: "Folienelemente" }).getByRole("button", { name: "HTML", exact: true }).click();
  await page.getByLabel("HTML und CSS", { exact: true }).fill(`<h2>Sommerfeldzahl ${nonce}</h2><p>S = η · n / p</p><table><thead><tr><th>Betriebspunkt</th><th>Reibzustand</th></tr></thead><tbody><tr><td>Anlauf</td><td>Mischreibung ${nonce}</td></tr></tbody></table>`);
  await page.getByRole("button", { name: "HTML einfügen", exact: true }).click();
  await toggleStudioPreview(page);
  const embedded = page.frameLocator("iframe.learnordie-canvas-html");
  await expect(embedded.getByRole("cell", { name: `Mischreibung ${nonce}`, exact: true })).toBeVisible();
  await expect(embedded.getByText("S = η · n / p", { exact: true })).toBeVisible();
  await save(page, lecture.id);
  await page.reload();
  await expect(page.getByLabel("Excalidraw-Folieneditor", { exact: true })).toHaveAttribute("data-canvas-ready", "true");
  await toggleStudioPreview(page);
  await expect(embedded.getByRole("cell", { name: `Mischreibung ${nonce}`, exact: true })).toBeVisible();
  await testInfo.attach("native-materials-formula-table-reload", { body: await page.screenshot(), contentType: "image/png" });
  clean();
});
