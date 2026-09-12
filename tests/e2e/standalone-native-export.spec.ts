import { test, expect } from "@playwright/test";
import { buildStandaloneCanvasRuntime } from "../../src/server/standalone-canvas-runtime";
import { renderStandaloneSlideDocumentHtml } from "../../packages/slide-engine/src/standalone";
import { legacySlidesToSlideDocument } from "../../packages/slide-engine/src/legacy";
import { canvasSceneForSlide } from "../../packages/slide-engine/src/excalidraw/scene";
import type { CanvasElement } from "../../packages/slide-engine/src/excalidraw/canvas-schema";

async function offlineHtml() {
  const document = legacySlidesToSlideDocument([{ id: "offline-native", title: "Native Offline QA", eyebrow: "QA", topic: "Export", copy: ["Stale block must not reappear"], diagram: "bearing" }]);
  const slide = document.slides[0];
  const scene = canvasSceneForSlide(slide, document.assets);
  const base = scene.elements[0];
  const native = (id: string, type: CanvasElement["type"], extra: Partial<CanvasElement>) => ({ ...base, id, type, x: 20, y: 20, width: 300, height: 100, text: undefined, originalText: undefined, ...extra }) as CanvasElement;
  // JSON removes undefined fields, exactly as persisted authoring data does.
  scene.elements = JSON.parse(JSON.stringify([
    native("offline-text", "text", { text: "Canvas-Text äöü", originalText: "Canvas-Text äöü", x: 40, y: 40, width: 650, height: 65, fontSize: 42 }),
    native("offline-shape", "rectangle", { x: 40, y: 150, width: 250, height: 130, backgroundColor: "#fff3bf", fillStyle: "solid", angle: 0.2 }),
    native("offline-image", "image", { x: 360, y: 150, width: 100, height: 100, fileId: "offline-png", status: "saved", scale: [1, 1] }),
    native("offline-html", "embeddable", { x: 750, y: 150, width: 650, height: 250, customData: { learnordie: { type: "html", title: "Offline HTML/CSS", html: '<style>h2{color:rgb(120,30,80)}</style><h2>Native HTML/CSS</h2><script>parent.pwned=true</script><a href="https://offline-denied.invalid">Unsafe link</a><iframe src="https://offline-denied.invalid"></iframe><meta http-equiv="refresh" content="0;url=https://offline-denied.invalid">' } } }),
    native("offline-3d", "embeddable", { x: 40, y: 440, width: 650, height: 380, customData: { learnordie: { type: "scene3d", sceneId: "modell.learning", caption: "Lernmodell" } } }),
  ]));
  scene.files = { "offline-png": { id: "offline-png", created: 0, mimeType: "image/png", dataURL: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=" } };
  slide.canvas = scene;
  return renderStandaloneSlideDocumentHtml({ document, metadata: { version: "native-offline-qa", exportedAt: "2026-09-12" }, dataJson: JSON.stringify({ lecture: { slideDocument: document } }), manifestJson: "{}", nativeCanvasRuntime: await buildStandaloneCanvasRuntime() });
}

test("downloaded native standalone renders true SVG, images, isolated HTML and static 3D with no network", async ({ page }) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", (route) => {
    if (/^https?:/.test(route.request().url())) { requests.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await page.setContent(await offlineHtml(), { waitUntil: "load" });
  const root = page.locator(".ld-native-export");
  await expect(root).toHaveAttribute("data-native-export-status", "ready", { timeout: 25000 });
  await expect(root.locator("[data-native-export-view] svg")).toBeVisible();
  await expect(root.locator("svg text").filter({ hasText: "Canvas-Text äöü" })).toBeVisible();
  await expect(root.locator("svg image")).toHaveCount(1);
  await expect(root.locator("[data-native-embed-id]")).toHaveCount(2);
  const html = page.frameLocator('iframe[title="Offline HTML/CSS"]');
  await expect(html.getByRole("heading", { name: "Native HTML/CSS" })).toHaveCSS("color", "rgb(120, 30, 80)");
  await expect(html.locator("script,a,iframe,meta[http-equiv=refresh]")).toHaveCount(0);
  expect(await page.locator('iframe[title="Offline HTML/CSS"]').getAttribute("sandbox")).toBe("");
  expect(await html.locator("body").evaluate(() => { try { return Boolean(window.parent.document); } catch { return false; } })).toBe(false);
  await expect(root.getByText(/Statische 3D-Ansicht \(offline nicht interaktiv\)/)).toBeVisible();
  expect(await root.locator('[data-native-embed-id="offline-3d"] img').evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByText("Stale block must not reappear", { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});

test("unsupported browser shows current native text and explicit failure, never stale blocks", async ({ page }) => {
  await page.evaluate(() => Object.defineProperty(window, "DecompressionStream", { value: undefined, configurable: true }));
  await page.setContent(await offlineHtml(), { waitUntil: "load" });
  await expect(page.locator(".ld-native-export")).toHaveAttribute("data-native-export-status", "failed");
  await expect(page.getByRole("alert")).toContainText("DecompressionStream");
  await page.getByText("Canvas-Text und Exporthinweise").click();
  await expect(page.getByText("Canvas-Text äöü", { exact: true })).toBeVisible();
});
