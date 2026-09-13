import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

// Serve the actual production sanitizer as a small browser-native test module.
// No duplicated sanitizer, eval, production test endpoint, or application secrets.
function sanitizerModule() {
  const file = path.join(process.cwd(), "src/components/excalidraw/CanvasEmbed.tsx");
  const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  const names = new Set(["MAX_CANVAS_HTML_LENGTH", "CANVAS_HTML_CSP", "ALLOWED_HTML_TAGS", "ALLOWED_HTML_ATTRIBUTES"]);
  const statements = source.statements.filter((statement) =>
    (ts.isFunctionDeclaration(statement) && statement.name?.text === "buildCanvasHtmlDocument") ||
    (ts.isVariableStatement(statement) && statement.declarationList.declarations.some((item) => ts.isIdentifier(item.name) && names.has(item.name.text))));
  const printer = ts.createPrinter();
  return ts.transpileModule(statements.map((node) => printer.printNode(ts.EmitHint.Unspecified, node, source)).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
}

test("HTML/CSS sidecar preserves content but blocks scripts, network, forms and parent access", async ({ page }) => {
  await page.route("**/__qa/canvas-html-module.mjs", (route) => route.fulfill({ contentType: "text/javascript", body: sanitizerModule() }));
  const forbiddenRequests: string[] = [];
  // Chromium emits request events even for CSP-blocked attempts. Only a request
  // reaching interception is eligible for network dispatch; abort it safely.
  await page.route("https://embed-denied.invalid/**", async (route) => {
    forbiddenRequests.push(route.request().url());
    await route.abort();
  });
  await page.goto("/");
  await page.evaluate(async () => {
    const helperUrl = "/__qa/canvas-html-module.mjs";
    const { buildCanvasHtmlDocument } = await import(helperUrl);
    const frame = document.createElement("iframe");
    frame.id = "canvas-html-unit";
    frame.setAttribute("sandbox", "");
    frame.srcdoc = buildCanvasHtmlDocument(`
      <style>@import url(https://embed-denied.invalid/style);body{background-image:url(https://embed-denied.invalid/pixel)}h2{color:rgb(120,30,80)}</style>
      <h2>Erlaubter Inhalt</h2><p>HTML und CSS</p>
      <script>parent.document.body.dataset.compromised='true';fetch('https://embed-denied.invalid/fetch')</script>
      <img src="https://embed-denied.invalid/image" onerror="parent.document.body.dataset.compromised='true'">
      <iframe src="https://embed-denied.invalid/frame"></iframe>
      <meta http-equiv="refresh" content="0;url=https://embed-denied.invalid/redirect">
      <a href="https://embed-denied.invalid/link" ping="https://embed-denied.invalid/ping">Unsafe link</a>
      <form action="https://embed-denied.invalid/form"><button>Send</button></form>
      <svg><a href="https://embed-denied.invalid/svg"><text>Unsafe SVG link</text></a></svg>
    `);
    document.body.append(frame);
  });
  const frame = page.frameLocator("#canvas-html-unit");
  await expect(frame.getByRole("heading", { name: "Erlaubter Inhalt" })).toHaveCSS("color", "rgb(120, 30, 80)");
  await expect(frame.locator("script,iframe,form,a,meta[http-equiv=refresh],[onerror],[href],[action]")).toHaveCount(0);
  expect(await page.locator("#canvas-html-unit").getAttribute("sandbox")).toBe("");
  expect(await page.locator("body").getAttribute("data-compromised")).toBeNull();
  expect(await frame.locator("body").evaluate(() => {
    try { return Boolean(window.parent.document); } catch { return false; }
  })).toBe(false);
  expect(forbiddenRequests).toEqual([]);
});

test("HTML sanitizer rejects oversized contents instead of truncating malformed markup", async ({ page }) => {
  await page.route("**/__qa/canvas-html-module.mjs", (route) => route.fulfill({ contentType: "text/javascript", body: sanitizerModule() }));
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const helperUrl = "/__qa/canvas-html-module.mjs";
    const { buildCanvasHtmlDocument } = await import(helperUrl);
    try { buildCanvasHtmlDocument("x".repeat(65_537)); return "accepted"; }
    catch (error) { return (error as Error).message; }
  });
  expect(result).toContain("65.536");
});
