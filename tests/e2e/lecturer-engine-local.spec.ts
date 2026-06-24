import { expect, type Page, test } from "@playwright/test";

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
  await page.getByRole("button", { name: "Magic Link senden" }).click();
  const link = page.getByRole("link", { name: "Referentenbereich öffnen" });
  await expect(link).toBeVisible();
  const href = await link.getAttribute("href");
  if (!href) throw new Error("Magic link was not rendered in local mail mode.");
  await page.goto(href);
  await expect(page).toHaveURL(/\/lecturer$/);

  const titleInput = page.getByRole("textbox", { name: "Folientitel" });
  if (!(await titleInput.isVisible({ timeout: 1_000 }).catch(() => false))) {
    const csrfToken = await page.locator("[data-csrf-token]").first().getAttribute("data-csrf-token");
    if (!csrfToken) throw new Error("Lecturer CSRF token missing during isolated lecture setup.");
    const createResponse = await page.request.post("/api/lectures", {
      headers: { "x-learnbuddy-csrf": csrfToken },
      data: {
        title: "Gleitlagerung",
        seriesTitle: "Maschinenelemente I",
        liveAt: "2026-06-19T11:00",
        examDate: "2026-07-24"
      }
    });
    expect(createResponse.ok()).toBe(true);
    await page.reload();
  }

  await expect(titleInput).toBeVisible();
}

test("Dozentenstudio speichert SlideDocument-Engine-Edits in der Lecture", async ({ page }) => {
  const assertClean = attachDiagnostics(page);
  const replacementText = `Engine-Editor speichert einen echten Folientext ${Date.now()}.`;

  await loginLecturer(page);
  await expect(page.getByRole("textbox", { name: "Folientitel" })).toBeVisible();

  await page.getByRole("button", { name: "Engine" }).click();
  await expect(page.locator('[data-studio-engine-editor="true"]')).toBeVisible();
  await page.locator('[data-studio-engine-editor="true"] [data-editor-block-type="paragraph"]').first().click();
  await page.getByLabel("Engine Folientext").fill(replacementText);
  await page.getByRole("button", { name: "Engine-Block speichern" }).click();
  await expect(page.getByText("Engine-Block gespeichert. Bitte Lecture speichern.")).toBeVisible();
  await expect(page.locator('[data-slide-copy-index="0"]')).toContainText(replacementText);

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
    block.type === "paragraph" && block.text === replacementText
  ))).toBe(true);

  await page.reload();
  await expect(page.locator('[data-slide-copy-index="0"]')).toContainText(replacementText);
  assertClean();
});

test("Dozentenstudio editiert native SlideDocument-Layouts, Assets, Formeln, Tabellen und Quizanker", async ({ page }) => {
  const assertClean = attachDiagnostics(page);
  const runId = Date.now();
  const formulaLatex = `S_${runId} = \\frac{\\eta \\cdot n}{p}`;
  const tableCell = `Mischreibung ${runId}`;

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

  await page.reload();
  await page.getByRole("button", { name: "Engine" }).click();
  const editor = page.locator('[data-studio-engine-editor="true"]');
  await expect(editor).toBeVisible();

  await page.getByLabel("Engine Layout").selectOption("technical_two_column");
  await expect(page.getByText("Engine-Layout gespeichert. Bitte Lecture speichern.")).toBeVisible();

  await editor.locator('[data-editor-block-type="figure"]').first().click();
  await page.getByLabel("Engine Asset").selectOption("asset-product-bearing-detail");
  await expect(page.getByText("Engine-Asset gespeichert. Bitte Lecture speichern.")).toBeVisible();

  await editor.locator('[data-editor-block-id="product-formula-test"]').click();
  await page.getByLabel("Engine Formel").fill(formulaLatex);
  await page.getByRole("button", { name: "Engine-Block speichern" }).click();
  await expect(page.getByText("Engine-Block gespeichert. Bitte Lecture speichern.")).toBeVisible();

  await editor.locator('[data-editor-block-id="product-table-test"]').click();
  await page.getByLabel("Engine Tabellenzeile").selectOption("0");
  await page.getByLabel("Engine Tabellenspalte").selectOption("1");
  await page.getByLabel("Engine Tabellenzelle").fill(tableCell);
  await page.getByRole("button", { name: "Zelle speichern" }).click();
  await expect(page.getByText("Engine-Tabellenzelle gespeichert. Bitte Lecture speichern.")).toBeVisible();

  await page.getByLabel("Engine Quizanker Niveau").selectOption("1.0");
  await page.getByRole("button", { name: "Quizanker setzen" }).click();
  await expect(page.getByText("Engine-Quizanker gespeichert. Bitte Lecture speichern.")).toBeVisible();

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
    assetId: "asset-product-bearing-detail"
  });
  expect(savedSlide?.quizAnchors).toEqual(expect.arrayContaining([
    expect.objectContaining({
      blockId: "product-table-test",
      level: "1.0"
    })
  ]));

  await page.reload();
  await page.getByRole("button", { name: "Engine" }).click();
  await expect(page.getByLabel("Engine Layout")).toHaveValue("technical_two_column");
  await editor.locator('[data-editor-block-id="product-formula-test"]').click();
  await expect(page.getByLabel("Engine Formel")).toHaveValue(formulaLatex);
  assertClean();
});

type LectureApiShape = {
  id: string;
  title: string;
  slideDocument?: SlideDocumentApiShape;
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
