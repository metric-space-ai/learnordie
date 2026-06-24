import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { allBlockTypesSlideDocument } from "@learnordie/slide-engine/fixtures";
import {
  AGENTIC_SLIDE_EDIT_CONTRACT,
  applySlideDocumentEdits,
  summarizeSlideDocumentForEditing
} from "@learnordie/slide-engine/editing";
import {
  renderStandaloneSlideDocumentHtml,
  SLIDE_STANDALONE_RENDERER_VERSION
} from "@learnordie/slide-engine/standalone";

type ViewportCase = {
  name: string;
  width: number;
  height: number;
};

type LayoutIssue = {
  kind: string;
  selector: string;
  text: string;
  details: Record<string, number | string | boolean | null>;
};

type QaTarget = {
  name: string;
  url: string;
};

const configuredSlideEngineQaUrl = process.env.SLIDE_ENGINE_QA_URL?.trim();
const qaTargets: QaTarget[] = configuredSlideEngineQaUrl
  ? [{ name: "custom", url: configuredSlideEngineQaUrl }]
  : [
      { name: "legacy-demo", url: "/slide-engine/qa" },
      { name: "blocks-text", url: "/slide-engine/qa/blocks?slide=blocks-text" },
      { name: "blocks-media", url: "/slide-engine/qa/blocks?slide=blocks-media" },
      { name: "blocks-reasoning", url: "/slide-engine/qa/blocks?slide=blocks-reasoning" }
    ];
const slideSelector = process.env.SLIDE_ENGINE_QA_SLIDE_SELECTOR?.trim()
  || "[data-slide-id], [data-slide-node-id], .slide, section";
const overflowTolerancePx = Number.parseFloat(process.env.SLIDE_ENGINE_QA_OVERFLOW_TOLERANCE_PX ?? "2");

const expectedSlideDocumentBlockTypes = [
  "heading",
  "paragraph",
  "bulletList",
  "numberedList",
  "definition",
  "callout",
  "figure",
  "formula",
  "table",
  "chart",
  "process",
  "comparison",
  "code",
  "quote",
  "quizAnchor",
  "spacer"
];

const viewportMatrix: ViewportCase[] = [
  { name: "desktop-1920", width: 1920, height: 1080 },
  { name: "laptop-1366", width: 1366, height: 768 },
  { name: "tablet-1024", width: 1024, height: 768 },
  { name: "ipad-portrait-834", width: 834, height: 1194 },
  { name: "mobile-390", width: 390, height: 844 }
];

function attachSlideEngineConsoleGuard(page: Page) {
  const problems: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      problems.push(`console:${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    problems.push(`pageerror:${error.message}`);
  });
  page.on("requestfailed", (request) => {
    const errorText = request.failure()?.errorText ?? "";
    if (errorText === "net::ERR_ABORTED") return;
    problems.push(`requestfailed:${request.method()} ${request.url()} ${errorText}`);
  });
  page.on("response", (response) => {
    if (response.status() >= 500) {
      problems.push(`response:${response.status()} ${response.url()}`);
    }
  });

  return () => expect(problems, problems.join("\n")).toEqual([]);
}

async function scanSlideEngineLayout(page: Page, options: { slideSelector: string; tolerancePx: number }) {
  return page.evaluate(({ slideSelector: selector, tolerancePx }) => {
    type BrowserLayoutIssue = {
      kind: string;
      selector: string;
      text: string;
      details: Record<string, number | string | boolean | null>;
    };

    const issues: BrowserLayoutIssue[] = [];
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth;
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight;
    const documentOverflowX = document.documentElement.scrollWidth - viewportWidth;

    function isVisible(element: Element) {
      if (!(element instanceof HTMLElement || element instanceof SVGElement)) return false;
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || Number.parseFloat(style.opacity) === 0) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    }

    function shortText(element: Element) {
      return (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    }

    function describeElement(element: Element) {
      const tag = element.tagName.toLowerCase();
      const id = element.id ? `#${element.id}` : "";
      const className = element instanceof HTMLElement
        ? Array.from(element.classList).slice(0, 4).map((item) => `.${item}`).join("")
        : "";
      const dataId = element.getAttribute("data-slide-id")
        ?? element.getAttribute("data-slide-node-id")
        ?? element.getAttribute("data-block-id")
        ?? element.getAttribute("data-qa-id")
        ?? "";
      return dataId ? `${tag}${id}${className}[${dataId}]` : `${tag}${id}${className}`;
    }

    function issue(kind: string, element: Element, details: Record<string, number | string | boolean | null>) {
      issues.push({
        kind,
        selector: describeElement(element),
        text: shortText(element),
        details
      });
    }

    if (documentOverflowX > tolerancePx) {
      issues.push({
        kind: "document-overflow-x",
        selector: "documentElement",
        text: "",
        details: {
          scrollWidth: document.documentElement.scrollWidth,
          viewportWidth,
          overflowPx: Math.round(documentOverflowX)
        }
      });
    }

    const visibleElements = Array.from(document.querySelectorAll("*")).filter(isVisible);
    for (const element of visibleElements) {
      const rect = element.getBoundingClientRect();
      const outsideLeft = rect.left < -tolerancePx;
      const outsideRight = rect.right > viewportWidth + tolerancePx;
      if (outsideLeft || outsideRight) {
        issue("element-outside-horizontal-viewport", element, {
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          viewportWidth,
          outsideLeft,
          outsideRight
        });
      }
    }

    const headings = Array.from(document.querySelectorAll("h1, h2, h3, [data-slide-title]")).filter(isVisible);
    for (const heading of headings) {
      const element = heading as HTMLElement;
      const style = window.getComputedStyle(element);
      const clipsInline = element.scrollWidth > element.clientWidth + tolerancePx
        && ["hidden", "clip"].includes(style.overflowX);
      const rect = element.getBoundingClientRect();
      const outsideViewport = rect.left < -tolerancePx || rect.right > viewportWidth + tolerancePx;
      if (clipsInline || outsideViewport) {
        issue("heading-clipped-or-outside", element, {
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          viewportWidth,
          overflowX: style.overflowX
        });
      }
    }

    const interactiveElements = Array.from(document.querySelectorAll([
      "button",
      "a[href]",
      "input",
      "select",
      "textarea",
      "[role='button']",
      "[data-quiz-anchor]",
      "[data-quiz-hotspot]",
      "[data-slide-hotspot]"
    ].join(","))).filter(isVisible);
    for (const element of interactiveElements) {
      const rect = element.getBoundingClientRect();
      const outsideViewport = rect.left < -tolerancePx
        || rect.right > viewportWidth + tolerancePx
        || rect.top < -tolerancePx
        || rect.bottom > viewportHeight + tolerancePx;
      if (outsideViewport) {
        issue("interactive-outside-viewport", element, {
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          right: Math.round(rect.right),
          bottom: Math.round(rect.bottom),
          viewportWidth,
          viewportHeight
        });
      }
    }

    const hotspots = Array.from(document.querySelectorAll("[data-quiz-anchor], [data-quiz-hotspot], [data-slide-hotspot]")).filter(isVisible);
    for (const hotspot of hotspots) {
      const rect = hotspot.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const centerInViewport = centerX >= 0 && centerX <= viewportWidth && centerY >= 0 && centerY <= viewportHeight;
      const topElement = centerInViewport ? document.elementFromPoint(centerX, centerY) : null;
      const covered = Boolean(topElement && topElement !== hotspot && !hotspot.contains(topElement));
      if (!centerInViewport || covered) {
        issue("hotspot-covered-or-outside", hotspot, {
          centerX: Math.round(centerX),
          centerY: Math.round(centerY),
          viewportWidth,
          viewportHeight,
          covered,
          topElement: topElement ? describeElement(topElement) : null
        });
      }
    }

    const formulaElements = Array.from(document.querySelectorAll([
      "math",
      ".katex",
      ".formula",
      "[data-block-type='formula']",
      "[data-slide-block-type='formula']"
    ].join(","))).filter(isVisible);
    for (const formula of formulaElements) {
      const element = formula as HTMLElement;
      const rect = element.getBoundingClientRect();
      const tooSmall = rect.height < 12 || rect.width < 12;
      const overflows = element.scrollWidth > element.clientWidth + tolerancePx;
      if (tooSmall || overflows) {
        issue("formula-unreadable", element, {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          tooSmall,
          overflows
        });
      }
    }

    const tables = Array.from(document.querySelectorAll("table, [data-block-type='table'], [data-slide-block-type='table']")).filter(isVisible);
    for (const table of tables) {
      const element = table as HTMLElement;
      const rect = element.getBoundingClientRect();
      const hasHorizontalScroll = element.scrollWidth > element.clientWidth + tolerancePx;
      const outsideViewport = rect.left < -tolerancePx || rect.right > viewportWidth + tolerancePx;
      if (hasHorizontalScroll && !["auto", "scroll"].includes(window.getComputedStyle(element).overflowX)) {
        issue("table-not-scrollable", element, {
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          overflowX: window.getComputedStyle(element).overflowX
        });
      }
      if (outsideViewport) {
        issue("table-outside-viewport", element, {
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          viewportWidth
        });
      }
    }

    const images = Array.from(document.images).filter(isVisible);
    for (const image of images) {
      if (!image.complete || image.naturalWidth === 0 || image.naturalHeight === 0) {
        issue("image-not-loaded", image, {
          complete: image.complete,
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight
        });
      }
    }

    const slideCandidates = Array.from(document.querySelectorAll(selector)).filter(isVisible);
    if (slideCandidates.length === 0) {
      issues.push({
        kind: "slide-root-missing",
        selector,
        text: "",
        details: {
          viewportWidth,
          viewportHeight
        }
      });
    }

    return {
      issues,
      summary: {
        viewportWidth,
        viewportHeight,
        documentOverflowX: Math.max(0, Math.round(documentOverflowX)),
        visibleElementCount: visibleElements.length,
        slideCandidateCount: slideCandidates.length,
        headingCount: headings.length,
        hotspotCount: hotspots.length,
        interactiveCount: interactiveElements.length
      }
    };
  }, options);
}

test("Slide Engine Track H QA contract is documented", async () => {
  const plan = await readFile(path.resolve("docs/slide-engine-fork-refactor-plan.md"), "utf8");
  const requiredText = [
    "## 6. SlideDocument als Source of Truth",
    "### 9.6 Step 6: Render-QA",
    "1920 x 1080 Desktop",
    "1366 x 768 Laptop",
    "1024 x 768 Tablet",
    "834 x 1194 iPad Portrait",
    "390 x 844 Mobile",
    "keine horizontalen Overflows",
    "Console clean",
    "### Track H: QA & Production Gates",
    "Playwright-Viewport-Matrix",
    "Overflow-Scanner",
    "Console-/Network-Gates",
    "Standalone-offline-Gate"
  ];

  const missing = requiredText.filter((text) => !plan.includes(text));
  expect(missing, `Missing Track H plan anchors:\n${missing.join("\n")}`).toEqual([]);
});

test.describe("SlideDocument renderer QA harness", () => {
  for (const target of qaTargets) {
    for (const viewport of viewportMatrix) {
      test(`${target.name}: viewport matrix, overflow scanner, and console guard: ${viewport.name}`, async ({ page }) => {
        const assertClean = attachSlideEngineConsoleGuard(page);

        await page.setViewportSize({ width: viewport.width, height: viewport.height });
        await page.goto(target.url, { waitUntil: "domcontentloaded" });
        await page.waitForLoadState("load");
        await page.evaluate(() => new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        }));

        await expect(page.getByText("Unsupported slide block")).toHaveCount(0);

        const scan = await scanSlideEngineLayout(page, {
          slideSelector,
          tolerancePx: overflowTolerancePx
        });

        expect(scan.issues as LayoutIssue[], JSON.stringify({
          target,
          viewport,
          summary: scan.summary,
          issues: scan.issues
        }, null, 2)).toEqual([]);
        assertClean();
      });
    }
  }

  test("all SlideDocument v1 block types render in the repo fixture", async ({ page }) => {
    test.skip(Boolean(configuredSlideEngineQaUrl), "Custom QA URLs cannot prove the bundled all-block fixture.");

    const renderedTypes = new Set<string>();
    const blockTargets = qaTargets.filter((target) => target.name.startsWith("blocks-"));

    for (const target of blockTargets) {
      await page.goto(target.url, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("load");
      await expect(page.getByText("Unsupported slide block")).toHaveCount(0);
      const types = await page.locator("[data-block-type]").evaluateAll((elements) => (
        elements
          .map((element) => element.getAttribute("data-block-type"))
          .filter((type): type is string => Boolean(type))
      ));
      for (const type of types) renderedTypes.add(type);
    }

    const missingTypes = expectedSlideDocumentBlockTypes.filter((type) => !renderedTypes.has(type));
    expect(missingTypes, `Missing block renderers: ${missingTypes.join(", ")}`).toEqual([]);
  });

  test("standalone SlideDocument export renders offline without external runtime requests", async ({ page }) => {
    const assertClean = attachSlideEngineConsoleGuard(page);
    const externalRequests: string[] = [];
    const dataJson = JSON.stringify({
      export: {
        offline: { selfContained: true, externalAssets: 0 },
        slideEngine: {
          renderer: SLIDE_STANDALONE_RENDERER_VERSION,
          slideDocumentSchemaVersion: allBlockTypesSlideDocument.schemaVersion,
          slideDocumentId: allBlockTypesSlideDocument.id
        }
      },
      lecture: {
        slideDocument: allBlockTypesSlideDocument
      }
    });
    const manifestJson = JSON.stringify({
      assets: [
        { path: "assets/styles.css", sha256: "fixture-style-sha" },
        { path: "assets/standalone.js", sha256: "fixture-script-sha" },
        { path: "learnbuddy-data.json", sha256: "fixture-data-sha" }
      ],
      externalAssetCount: 0,
      selfContained: true
    });
    const html = renderStandaloneSlideDocumentHtml({
      dataJson,
      document: allBlockTypesSlideDocument,
      manifestJson,
      metadata: {
        version: "standalone-html-test",
        exportedAt: "2026-06-24T00:00:00.000Z",
        title: "Slide Engine Offline QA",
        seriesTitle: "learnordie QA",
        payloadSha256: "fixture-payload-sha",
        manifestSha256: "fixture-manifest-sha",
        selfContained: true,
        externalAssetCount: 0
      },
      questions: [
        {
          level: "2.0",
          text: "Welche Aussage beschreibt den Vorteil eines strukturierten SlideDocument?",
          explanation: "Strukturierte Blöcke bleiben validierbar, adressierbar und reparierbar.",
          answers: [
            { key: "A", text: "Blöcke können gezielt validiert und repariert werden.", correct: true },
            { key: "B", text: "Freies HTML wird dadurch ungeprüft gespeichert.", correct: false },
            { key: "C", text: "Quellenbezüge werden dadurch unnötig.", correct: false },
            { key: "D", text: "Mobile-Reflow wird dadurch abgeschaltet.", correct: false }
          ]
        }
      ]
    });

    await page.route("**/*", async (route) => {
      externalRequests.push(route.request().url());
      await route.abort();
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.setContent(html, { waitUntil: "load" });

    await expect(page.locator(`[data-slide-engine="${SLIDE_STANDALONE_RENDERER_VERSION}"]`)).toBeVisible();
    await expect(page.locator("[data-slide-document-version]")).toHaveAttribute("data-slide-document-version", "learnordie.slide.v1");
    await expect(page.locator("[data-block-type='chart']")).toBeVisible();
    await expect(page.locator("[data-block-type='quizAnchor']")).toBeVisible();
    await expect(page.getByText("assets/styles.css · fixture-style-sha")).toBeVisible();
    await page.getByRole("button", { name: /Antwort A:/ }).click();
    await expect(page.getByText("Richtig.")).toBeVisible();
    expect(externalRequests).toEqual([]);
    assertClean();
  });

  test("agentic SlideDocument edit batches stay validated and target stable ids", async () => {
    const beforeSummary = summarizeSlideDocumentForEditing(allBlockTypesSlideDocument);
    const result = applySlideDocumentEdits(allBlockTypesSlideDocument, [
      {
        operationId: "agent-update-slide-title",
        kind: "updateSlide",
        slideId: "blocks-text",
        patch: {
          title: "Agentisch editierte Struktur",
          layout: "technical_one_column"
        },
        context: { actor: "agent", reason: "Titel und Layout anpassen" }
      },
      {
        operationId: "agent-patch-paragraph",
        kind: "patchBlock",
        slideId: "blocks-text",
        blockId: "text-paragraph",
        patch: {
          text: "Agenten ändern gezielt einzelne Blöcke und behalten stabile IDs für QA und Repair."
        },
        context: { actor: "agent", reason: "Präzisere Aussage" }
      },
      {
        operationId: "agent-insert-callout",
        kind: "insertBlock",
        slideId: "blocks-text",
        afterBlockId: "text-paragraph",
        block: {
          id: "text-agentic-callout",
          type: "callout",
          tone: "tip",
          title: "Agentenregel",
          text: "Ändere strukturierte Blöcke, nicht DOM-Strings."
        },
        context: { actor: "agent", source: "repair-loop" }
      },
      {
        operationId: "agent-note",
        kind: "upsertSpeakerNote",
        slideId: "blocks-text",
        note: {
          id: "note-agentic-editing",
          kind: "talkingPoint",
          blockId: "text-agentic-callout",
          text: "Diese Notiz zeigt, dass Editor und Agent dieselben Block-IDs verwenden."
        }
      },
      {
        operationId: "agent-quiz-anchor",
        kind: "upsertQuizAnchor",
        slideId: "blocks-text",
        anchor: {
          id: "anchor-agentic-editing",
          level: "2.0",
          blockId: "text-agentic-callout",
          label: "Agentische Editierung"
        }
      }
    ]);

    expect(result.ok, result.ok ? "" : JSON.stringify(result.issues, null, 2)).toBe(true);
    if (!result.ok) throw new Error("Expected agentic edit batch to be valid.");
    expect(result.appliedOperations).toEqual([
      "agent-update-slide-title",
      "agent-patch-paragraph",
      "agent-insert-callout",
      "agent-note",
      "agent-quiz-anchor"
    ]);
    const afterSummary = summarizeSlideDocumentForEditing(result.document);
    expect(afterSummary.blockCount).toBe(beforeSummary.blockCount + 1);
    expect(afterSummary.quizAnchorCount).toBe(beforeSummary.quizAnchorCount + 1);
    expect(afterSummary.speakerNoteCount).toBe(beforeSummary.speakerNoteCount + 1);
    const editedSlide = result.document.slides.find((slide) => slide.id === "blocks-text");
    expect(editedSlide?.title).toBe("Agentisch editierte Struktur");
    expect(editedSlide?.blocks.some((block) => block.id === "text-agentic-callout")).toBe(true);
    expect(AGENTIC_SLIDE_EDIT_CONTRACT.operationKinds).toContain("patchBlock");
    expect(AGENTIC_SLIDE_EDIT_CONTRACT.stableTargets).toContain("blockId");
  });

  test("agentic SlideDocument edits return repair issues for invalid operations", async () => {
    const missingTarget = applySlideDocumentEdits(allBlockTypesSlideDocument, [
      {
        operationId: "agent-missing-block",
        kind: "patchBlock",
        slideId: "blocks-text",
        blockId: "does-not-exist",
        patch: { text: "Kann nicht angewendet werden." }
      }
    ]);

    expect(missingTarget.ok).toBe(false);
    if (missingTarget.ok) throw new Error("Expected missing target edit to be rejected.");
    expect(missingTarget.rejectedOperation).toBe("agent-missing-block");
    expect(missingTarget.issues[0]).toMatchObject({
      code: "edit.block_missing",
      slideId: "blocks-text",
      blockId: "does-not-exist"
    });

    const invalidDocument = applySlideDocumentEdits(allBlockTypesSlideDocument, [
      {
        operationId: "agent-break-formula",
        kind: "patchBlock",
        slideId: "blocks-media",
        blockId: "media-formula",
        patch: {
          mathMl: "<math><mi>S</mi></math>"
        }
      }
    ]);

    expect(invalidDocument.ok).toBe(false);
    if (invalidDocument.ok) throw new Error("Expected invalid document edit to fail validation.");
    expect(invalidDocument.appliedOperations).toEqual(["agent-break-formula"]);
    expect(invalidDocument.issues.some((issue) => issue.code === "formula.source_ambiguity" && issue.blockId === "media-formula")).toBe(true);
  });
});
