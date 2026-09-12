import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { gunzipSync } from "node:zlib";
import { buildStandaloneCanvasRuntime, encodeStandaloneDownload } from "../../src/server/standalone-canvas-runtime";
import { renderStandaloneSlideDocumentHtml, standaloneScript, standaloneStyles } from "../../packages/slide-engine/src/standalone";
import { renderStandaloneCanvas, STANDALONE_CANVAS_CSP } from "../../packages/slide-engine/src/standalone-canvas";
import { legacySlidesToSlideDocument } from "../../packages/slide-engine/src/legacy";
import { canvasSceneForSlide } from "../../packages/slide-engine/src/excalidraw/scene";

function fixture() {
  const document = legacySlidesToSlideDocument([{ id: "export-slide", title: "Canvas QA", eyebrow: "Test", topic: "Export", copy: ["Obsolete block content"], diagram: "bearing" }]);
  const slide = document.slides[0];
  slide.canvas = canvasSceneForSlide(slide, document.assets);
  slide.canvas.elements = [
    { id: "native-text", type: "text", x: 20, y: 30, width: 700, height: 80, text: "Aktueller Canvas-Text äöü", fontSize: 42, fontFamily: 5 },
    { id: "native-rectangle", type: "rectangle", x: 100, y: 140, width: 230, height: 170, backgroundColor: "#fff3bf", strokeColor: "#197c70", angle: 0.15 },
    { id: "native-html", type: "embeddable", x: 500, y: 150, width: 400, height: 240, customData: { learnordie: { type: "html", title: "HTML QA", html: "<h2>Native HTML</h2><script>parent.pwned=true</script>" } } },
    { id: "native-3d", type: "embeddable", x: 100, y: 450, width: 450, height: 300, customData: { learnordie: { type: "scene3d", sceneId: "modell.learning", caption: "Lernmodell" } } },
  ];
  return document;
}

test("offline closure is integrity checked, font-local, cached, and carries licenses", async (context) => {
  const first = buildStandaloneCanvasRuntime();
  assert.equal(first, buildStandaloneCanvasRuntime());
  const runtime = await first;
  assert.equal(runtime.sha256, crypto.createHash("sha256").update(runtime.source).digest("hex"));
  assert.equal(runtime.vendorSha256.length, 64);
  assert.ok(runtime.fontFiles >= 20);
  const encoded = runtime.source.match(/atob\("([A-Za-z0-9+/=]+)"\)/)?.[1];
  assert.ok(encoded);
  const closure = gunzipSync(Buffer.from(encoded, "base64")).toString("utf8");
  assert.equal(Buffer.byteLength(closure), runtime.uncompressedBytes);
  assert.ok(Buffer.byteLength(runtime.source) < 4 * 1024 * 1024);
  assert.match(closure, /window\.__learnordieOfflineSvg = [\w$]+;/);
  assert.match(closure, /data:font\/woff2;base64,/);
  assert.doesNotMatch(closure, /"\.\/fonts\/[^"\r\n]+\.woff2"/);
  assert.doesNotMatch(closure, /"ASSETS_FALLBACK_URL",new URL/);
  assert.match(runtime.licenses, /Copyright \(c\) 2020 Excalidraw/);
  assert.match(runtime.licenses, /SIL OPEN FONT LICENSE/);
  context.diagnostic(JSON.stringify({ compressedModuleBytes: Buffer.byteLength(runtime.source), expandedModuleBytes: runtime.uncompressedBytes, fontFiles: runtime.fontFiles, licenseBytes: Buffer.byteLength(runtime.licenses) }));
});

test("native canvas is authoritative, preserving every element instead of stale legacy blocks", async () => {
  const document = fixture();
  const html = renderStandaloneSlideDocumentHtml({ document, metadata: { version: "qa", exportedAt: "2026-09-12" }, dataJson: "{}", manifestJson: "{}", nativeCanvasRuntime: await buildStandaloneCanvasRuntime() });
  assert.doesNotMatch(html, /Obsolete block content/);
  for (const id of ["native-text", "native-rectangle", "native-html", "native-3d"]) assert.ok(html.includes(id));
  assert.match(html, /Aktueller Canvas-Text äöü/);
  assert.match(html, /data-native-runtime-sha256/);
  assert.match(html, /Statische 3D-Ansicht/);
  assert.match(html, /data:image\/svg\+xml/);
  assert.match(html, /Content-Security-Policy/);
  assert.doesNotMatch(html, /<script>parent.pwned/);
});

test("missing runtime is an explicit unsupported state, never a successful legacy fallback", () => {
  const html = renderStandaloneCanvas(fixture().slides[0].canvas!, false);
  assert.match(html, /data-native-export-status="unsupported"/);
  assert.match(html, /Native Canvas-Darstellung fehlt/);
  assert.match(html, /Aktueller Canvas-Text/);
  assert.doesNotMatch(html, /Obsolete block content/);
});

test("hydration script is self-contained, scripts-disabled for HTML, and distinct from styles", () => {
  const script = standaloneScript();
  assert.match(script, /hydrateStandaloneCanvas/);
  assert.match(script, /moveAnswerFocus/);
  assert.match(script, /setAttribute\("sandbox", ""\)/);
  assert.match(script, /script-src 'none'/);
  assert.match(script, /renderedEmbeds !== embeds.size/);
  assert.match(script, /keine veraltete Block-Fassung/);
  assert.doesNotMatch(script, /allow-scripts|allow-same-origin|eval\(/);
  assert.doesNotMatch(standaloneStyles(), /hydrateStandaloneCanvas/);
  assert.match(STANDALONE_CANVAS_CSP, /connect-src data:/);
});

test("deleted native elements are absent from readable fallback and snapshots", () => {
  const scene = fixture().slides[0].canvas!;
  scene.elements.forEach((element) => { element.isDeleted = true; });
  const html = renderStandaloneCanvas(scene, true);
  const visible = html.slice(0, html.indexOf('<script type="application/json"'));
  assert.doesNotMatch(visible, /Aktueller Canvas-Text|Lernmodell|Native HTML/);
  assert.match(visible, /0 Elemente/);
});

test("script closing sequences and quoted URLs cannot break out of data, notices or runtime", () => {
  const document = fixture();
  document.slides[0].canvas!.elements[2].customData!.learnordie = {
    type: "html", title: '" onload="alert(1)',
    html: '</script><img src="https://denied.invalid/a?x=\" onerror=alert(1)"><meta http-equiv="refresh" content="0;url=https://denied.invalid">',
  };
  const html = renderStandaloneSlideDocumentHtml({ document, metadata: { version: "qa", exportedAt: "2026-09-12" }, dataJson: "{}", manifestJson: "{}", nativeCanvasRuntime: { source: 'const example = "</script><script>escaped</script>";', sha256: '"quoted', licenses: '<img src="https://denied.invalid/license">' } });
  assert.doesNotMatch(html, /<img src="https:\/\/denied\.invalid/);
  assert.match(html, /\\u003c\/script\\u003e/);
  assert.match(html, /const example = "<\\\/script><script>escaped<\\\/script>"/);
  assert.match(html, /data-native-runtime-sha256="&quot;quoted"/);
  assert.match(html, /&lt;img src=&quot;https:\/\/denied\.invalid\/license&quot;&gt;/);
});

test("native download negotiation preserves exact decoded bytes and enforces response budget", () => {
  const bytes = Buffer.from("Canvas export äöü".repeat(300000));
  const encoded = encodeStandaloneDownload(bytes, "br, gzip;q=1, deflate");
  assert.equal(encoded.encoding, "gzip");
  assert.equal(encoded.tooLarge, false);
  assert.deepEqual(gunzipSync(encoded.body), bytes);
  const unsupported = encodeStandaloneDownload(bytes, "gzip;q=0, br");
  assert.equal(unsupported.encoding, undefined);
  assert.equal(unsupported.tooLarge, true);
  assert.deepEqual(unsupported.body, bytes);
});
