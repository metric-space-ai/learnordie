import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, test } from "@playwright/test";

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

const slideEngineQaUrl = process.env.SLIDE_ENGINE_QA_URL?.trim() || "/slide-engine/qa";
const slideSelector = process.env.SLIDE_ENGINE_QA_SLIDE_SELECTOR?.trim()
  || "[data-slide-id], [data-slide-node-id], .slide, section";
const overflowTolerancePx = Number.parseFloat(process.env.SLIDE_ENGINE_QA_OVERFLOW_TOLERANCE_PX ?? "2");

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
  test.skip(!slideEngineQaUrl, "Set SLIDE_ENGINE_QA_URL to a renderer route or standalone fixture when SlideEngineCanvas exists.");

  for (const viewport of viewportMatrix) {
    test(`viewport matrix, overflow scanner, and console guard: ${viewport.name}`, async ({ page }) => {
      const assertClean = attachSlideEngineConsoleGuard(page);

      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(slideEngineQaUrl, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("load");
      await page.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }));

      const scan = await scanSlideEngineLayout(page, {
        slideSelector,
        tolerancePx: overflowTolerancePx
      });

      expect(scan.issues as LayoutIssue[], JSON.stringify({
        viewport,
        summary: scan.summary,
        issues: scan.issues
      }, null, 2)).toEqual([]);
      assertClean();
    });
  }
});
