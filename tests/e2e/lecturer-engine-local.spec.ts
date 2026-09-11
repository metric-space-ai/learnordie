import { expect, type Locator, type Page, test } from "@playwright/test";

function attachDiagnostics(page: Page) {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("Failed to load resource")) {
      problems.push(`console:${message.text()}`);
    }
  });
  page.on("pageerror", (error) => problems.push(`pageerror:${error.message}`));
  page.on("response", (response) => {
    if (response.status() >= 500) problems.push(`response:${response.status()} ${response.url()}`);
  });
  return () => expect(problems, problems.join("\n")).toEqual([]);
}

async function loginLecturer(page: Page) {
  const email = `engine-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
  await page.goto("/lecturer/login");
  await page.getByLabel("E-Mail").fill(email);
  await page.getByRole("button", { name: "Einloggen oder Konto erstellen" }).click();
  const link = page.getByRole("link", { name: "Direkt zum Dozentenbereich" });
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  if (!href) throw new Error("Magic link was not rendered in local mail mode.");
  await page.goto(href);
  await expect(page).toHaveURL(/\/lecturer$/);
  await expect(page.getByLabel("Präsentation bearbeiten")).toBeVisible();
}

async function clickVisibleEditorBlock(locator: Locator) {
  await locator.dispatchEvent("click");
}

test("Dozentenstudio speichert direkte Folienänderungen", async ({ page }) => {
  const assertClean = attachDiagnostics(page);
  const replacementText = `Direktbearbeitung speichert einen echten Folientitel ${Date.now()}.`;

  await loginLecturer(page);
  await expect(page.getByLabel("Präsentation bearbeiten")).toBeVisible();

  await page.getByRole("button", { name: "Folie direkt bearbeiten" }).click();
  await expect(page.locator('[data-studio-engine-editor="true"]')).toBeVisible();
  await page.getByText("Direkt bearbeiten", { exact: true }).click();
  await page.getByLabel("Folientitel", { exact: true }).fill(replacementText);
  await page.getByRole("button", { name: "Änderung speichern" }).click();
  await expect(page.getByText("Inhalt geändert. Bitte Vorlesung speichern.")).toBeVisible();
  await expect(page.locator(".studio-engine-editor-preview").getByText(replacementText, { exact: true }).first()).toBeVisible();

  const saveResponsePromise = page.waitForResponse((response) => (
    response.url().includes("/api/lectures/") &&
    response.request().method() === "PATCH"
  ));
  await page.locator(".studio-save-inline").click();
  const saveResponse = await saveResponsePromise;
  expect(saveResponse.ok()).toBe(true);
  const savePayload = await saveResponse.json() as {
    lectures?: Array<{
      title: string;
      slideDocument?: {
        slides?: Array<{
          blocks?: Array<{ type?: string; text?: string }>;
        }>;
      };
    }>;
  };
  const savedLecture = savePayload.lectures?.find((lecture) => lecture.title === "Gleitlagerung");
  expect(savedLecture?.slideDocument?.slides?.[0]?.blocks?.some((block) => (
    block.type === "heading" && block.text === replacementText
  ))).toBe(true);

  await page.reload();
  await expect(page.locator(".studio-engine-primary-deck").getByText(replacementText, { exact: true })).toBeVisible();
  assertClean();
});

test("Dozentenstudio schlägt eine kontextbezogene Änderung vor und übernimmt sie", async ({ page }) => {
  const assertClean = attachDiagnostics(page);
  const agentInstruction = `Mischreibung präziser einordnen ${Date.now()}`;

  await loginLecturer(page);
  await page.getByRole("button", { name: "Folie direkt bearbeiten" }).click();
  const editor = page.locator('[data-studio-engine-editor="true"]');
  await expect(editor).toBeVisible();

  await page.getByLabel("Änderungswunsch für Titel").fill(agentInstruction);

  const threadResponsePromise = page.waitForResponse((response) => (
    response.url().includes("/api/lectures/") &&
    response.url().includes("/agent-threads") &&
    response.request().method() === "POST"
  ));
  await page.getByRole("button", { name: "Änderung vorschlagen" }).click();
  const threadResponse = await threadResponsePromise;
  expect(threadResponse.ok()).toBe(true);
  await expect(page.getByText("Vorschlag bereit.")).toBeVisible();

  const acceptResponsePromise = page.waitForResponse((response) => (
    response.url().includes("/agent-threads/") &&
    response.url().includes("/accept") &&
    response.request().method() === "POST"
  ));
  await page.getByRole("button", { name: "Übernehmen" }).click();
  const acceptResponse = await acceptResponsePromise;
  expect(acceptResponse.ok()).toBe(true);
  const acceptPayload = await acceptResponse.json() as {
    lecture?: { slideDocument?: { slides?: Array<{ blocks?: Array<{ type?: string; text?: string }> }> } };
  };
  const acceptedHeading = acceptPayload.lecture?.slideDocument?.slides?.[0]?.blocks?.find((block) => block.type === "heading")?.text;
  expect(acceptedHeading).toBeTruthy();
  expect(acceptedHeading).not.toMatch(/<\/?think>/i);
  await expect(page.getByText("Änderung übernommen.")).toBeVisible();
  await expect(page.locator(".studio-engine-editor-preview").getByText(acceptedHeading!, { exact: true }).first()).toBeVisible();

  await page.reload();
  await expect(page.locator(".studio-engine-primary-deck").getByText(acceptedHeading!, { exact: true })).toBeVisible();
  assertClean();
});

test("Dozentenstudio editiert native SlideDocument-Layouts, Assets, Formeln, Tabellen und Quizanker", async ({ page }) => {
  const assertClean = attachDiagnostics(page);
  const runId = Date.now();
  const formulaLatex = `S_${runId} = \\frac{\\eta \\cdot n}{p}`;
  const tableCell = `Mischreibung ${runId}`;
  const libraryNote = `Stribeck-Diagramm ${runId}: Diagramm der Stribeck-Kurve mit Mischreibung, hydrodynamischer Gleitlagerung und Sommerfeldzahl.`;

  await loginLecturer(page);
  const csrfToken = await page.locator("[data-csrf-token]").first().getAttribute("data-csrf-token");
  if (!csrfToken) throw new Error("Lecturer CSRF token missing.");

  const lecturesResponse = await page.request.get("/api/lectures");
  expect(lecturesResponse.ok()).toBe(true);
  const lecturesPayload = await lecturesResponse.json() as { lectures?: Array<LectureApiShape> };
  const lecture = lecturesPayload.lectures?.find((item) => item.title === "Gleitlagerung");
  if (!lecture?.slideDocument) throw new Error("Demo lecture is missing slideDocument.");

  const injectedDocument = withNativeEditorBlocks(lecture.slideDocument, runId);
  const patchResponse = await page.request.patch(`/api/lectures/${lecture.id}`, {
    headers: { "x-learnbuddy-csrf": csrfToken },
    data: { slideDocument: injectedDocument }
  });
  expect(patchResponse.ok()).toBe(true);

  const materialResponse = await page.request.post(`/api/lectures/${lecture.id}/materials`, {
    headers: { "x-learnbuddy-csrf": csrfToken },
    multipart: { notes: libraryNote }
  });
  expect(materialResponse.status()).toBe(201);
  const processingResponse = await page.request.post(`/api/lectures/${lecture.id}/process-materials`, {
    headers: { "x-learnbuddy-csrf": csrfToken }
  });
  const processingPayload = await processingResponse.json() as { error?: string };
  expect(processingResponse.ok(), processingPayload.error ?? "Material processing failed.").toBe(true);
  const libraryResponse = await page.request.get("/api/lectures");
  expect(libraryResponse.ok()).toBe(true);
  const libraryPayload = await libraryResponse.json() as { lectures?: Array<LectureApiShape> };
  const libraryLecture = libraryPayload.lectures?.find((item) => item.id === lecture.id);
  const libraryAsset = libraryLecture?.presentationAssets?.find((asset) => asset.kind === "diagram" && asset.extractedText?.includes(`Stribeck-Diagramm ${runId}`));
  if (!libraryAsset) throw new Error("Processed presentation diagram asset was not returned by /api/lectures.");

  await page.reload();
  await page.getByRole("button", { name: /Alle anzeigen/ }).click();
  await expect(page.getByLabel("Asset-Galerie")).toContainText("Diagramm");
  await expect(page.getByLabel("Asset-Galerie")).toContainText("Prüfen");
  await page.getByLabel("Galerie schließen").click();

  await page.getByRole("button", { name: "Folie direkt bearbeiten" }).click();
  const editor = page.locator('[data-studio-engine-editor="true"]');
  await expect(editor).toBeVisible();
  await page.getByText("Direkt bearbeiten", { exact: true }).click();

  await page.getByLabel("Layout", { exact: true }).selectOption("technical_two_column");
  await expect(page.getByText("Layout geändert. Bitte Vorlesung speichern.")).toBeVisible();

  await clickVisibleEditorBlock(editor.locator('[data-editor-block-type="figure"]').first());
  await page.getByLabel("Bild", { exact: true }).selectOption(libraryAsset.id);
  await expect(page.getByText("Bild geändert. Bitte Vorlesung speichern.")).toBeVisible();

  await clickVisibleEditorBlock(editor.locator('[data-editor-block-id="product-formula-test"]'));
  await page.getByLabel("Formel", { exact: true }).fill(formulaLatex);
  await page.getByRole("button", { name: "Änderung speichern" }).click();
  await expect(page.getByText("Inhalt geändert. Bitte Vorlesung speichern.")).toBeVisible();

  await clickVisibleEditorBlock(editor.locator('[data-editor-block-id="product-table-test"]'));
  await page.getByLabel("Tabellenzeile").selectOption("0");
  await page.getByLabel("Tabellenspalte").selectOption("1");
  await page.getByLabel("Tabellenzelle").fill(tableCell);
  await page.getByRole("button", { name: "Zelle speichern" }).click();
  await expect(page.getByText("Tabellenzelle geändert. Bitte Vorlesung speichern.")).toBeVisible();

  await page.getByLabel("Fragenanker Niveau").selectOption("1.0");
  await page.getByRole("button", { name: "Quizanker setzen" }).click();
  await expect(page.getByText("Fragenanker geändert. Bitte Vorlesung speichern.")).toBeVisible();

  const saveResponsePromise = page.waitForResponse((response) => (
    response.url().includes("/api/lectures/") &&
    response.request().method() === "PATCH"
  ));
  await page.locator(".studio-save-inline").click();
  const saveResponse = await saveResponsePromise;
  expect(saveResponse.ok()).toBe(true);
  const savePayload = await saveResponse.json() as { lectures?: Array<LectureApiShape> };
  const savedLecture = savePayload.lectures?.find((item) => item.title === "Gleitlagerung");
  const savedSlide = savedLecture?.slideDocument?.slides?.[0];
  expect(savedSlide?.layout).toBe("technical_two_column");
  expect(savedSlide?.blocks?.find((block) => block.id === "product-formula-test")).toMatchObject({
    type: "formula",
    latex: formulaLatex
  });
  expect(savedSlide?.blocks?.find((block) => block.id === "product-table-test")).toMatchObject({
    type: "table",
    rows: expect.arrayContaining([
      expect.arrayContaining([tableCell])
    ])
  });
  expect(savedSlide?.blocks?.find((block) => block.type === "figure")).toMatchObject({
    assetId: libraryAsset.id
  });
  expect(savedLecture?.slideDocument?.assets).toEqual(expect.arrayContaining([
    expect.objectContaining({
      id: libraryAsset.id,
      kind: "diagram",
      title: libraryAsset.title,
      quality: expect.objectContaining({ needsReview: true })
    })
  ]));
  expect(savedSlide?.quizAnchors).toEqual(expect.arrayContaining([
    expect.objectContaining({
      blockId: "product-table-test",
      level: "1.0"
    })
  ]));

  await page.reload();
  await page.getByRole("button", { name: "Folie direkt bearbeiten" }).click();
  await page.getByText("Direkt bearbeiten", { exact: true }).click();
  await expect(page.getByLabel("Layout", { exact: true })).toHaveValue("technical_two_column");
  await clickVisibleEditorBlock(editor.locator('[data-editor-block-type="figure"]').first());
  await expect(page.getByLabel("Bild", { exact: true })).toHaveValue(libraryAsset.id);
  await clickVisibleEditorBlock(editor.locator('[data-editor-block-id="product-formula-test"]'));
  await expect(page.getByLabel("Formel", { exact: true })).toHaveValue(formulaLatex);
  assertClean();
});

test("AI-first Studio bleibt mobil fokussiert und frei von internen Laufzeitbegriffen", async ({ page }) => {
  const assertClean = attachDiagnostics(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await loginLecturer(page);

  const stage = page.getByLabel("Präsentation bearbeiten");
  const composer = page.locator(".studio-intent-dock");
  await expect(stage).toBeVisible();
  await expect(composer).toBeVisible();
  await expect(composer.getByPlaceholder("Was soll sich ändern?")).toBeVisible();

  const composerBox = await composer.boundingBox();
  expect(composerBox).not.toBeNull();
  expect(composerBox!.x).toBeGreaterThanOrEqual(0);
  expect(composerBox!.x + composerBox!.width).toBeLessThanOrEqual(390);
  expect(composerBox!.y + composerBox!.height).toBeLessThanOrEqual(844);

  await expect(page.getByText("Engine", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Review-Diff", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Agent Prompt", { exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "Folie direkt bearbeiten" }).click();
  await expect(page.getByLabel("Folie direkt bearbeiten")).toBeVisible();
  await expect(page.locator(".studio-direct-controls")).not.toHaveAttribute("open", "");
  await expect(page.getByLabel(/Änderungswunsch für/)).toBeVisible();
  assertClean();
});

type LectureApiShape = {
  id: string;
  title: string;
  slideDocument?: SlideDocumentApiShape;
  presentationAssets?: Array<{
    id: string;
    kind: string;
    title: string;
    extractedText?: string;
  }>;
};

type SlideDocumentApiShape = {
  schemaVersion: string;
  id: string;
  title: string;
  language: string;
  aspect: string;
  theme: string;
  deckSettings: Record<string, unknown>;
  slides: Array<{
    id: string;
    title: string;
    layout: string;
    intent: string;
    blocks: Array<Record<string, unknown> & { id: string; type: string }>;
    quizAnchors?: Array<Record<string, unknown>>;
    sourceRefs: Array<Record<string, unknown>>;
  }>;
  assets: Array<Record<string, unknown> & { id: string; kind: string; title: string }>;
  createdBy: Record<string, unknown>;
};

function withNativeEditorBlocks(document: SlideDocumentApiShape, runId: number): SlideDocumentApiShape {
  const next = JSON.parse(JSON.stringify(document)) as SlideDocumentApiShape;
  const firstSlide = next.slides[0];
  if (!firstSlide) throw new Error("SlideDocument has no first slide.");
  firstSlide.layout = "technical_one_column";
  firstSlide.blocks = firstSlide.blocks.filter((block) => (
    block.id !== "product-formula-test" &&
    block.id !== "product-table-test"
  ));
  firstSlide.blocks.push(
    {
      id: "product-formula-test",
      type: "formula",
      latex: "S = eta * n / p",
      caption: "Sommerfeldzahl als dimensionslose Kenngröße"
    },
    {
      id: "product-table-test",
      type: "table",
      caption: "Reibzustände im Überblick",
      columns: ["Betriebspunkt", "Reibzustand"],
      rows: [
        ["Anlauf", "Mischreibung"],
        ["Auslegung", "Flüssigkeitsreibung"]
      ],
      mobileStrategy: "cards"
    }
  );
  firstSlide.quizAnchors = (firstSlide.quizAnchors ?? []).filter((anchor) => (
    anchor.blockId !== "product-table-test"
  ));

  next.assets = next.assets.filter((asset) => asset.id !== "asset-product-bearing-detail");
  next.assets.push({
    id: "asset-product-bearing-detail",
    kind: "diagram",
    title: "Schmierfilm-Detail",
    url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
  <rect width="640" height="360" rx="30" fill="#edf6f8"/>
  <path d="M92 250c78-95 171-97 276-20 66 49 119 39 178-76" fill="none" stroke="#2b82ad" stroke-width="18" stroke-linecap="round"/>
  <path d="M160 190c82 70 201 55 270-62" fill="none" stroke="#c28516" stroke-width="22" stroke-linecap="round"/>
  <circle cx="305" cy="160" r="74" fill="#f8fbfc" stroke="#36515c" stroke-width="12"/>
  <text x="84" y="70" fill="#001926" font-family="Arial" font-size="34" font-weight="700">Schmierfilm ${runId}</text>
</svg>
`)}`,
    altText: "Abstrahierte Detailgrafik eines Schmierfilms im Gleitlager.",
    quality: { needsReview: false }
  });
  return next;
}
