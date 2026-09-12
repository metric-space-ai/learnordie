import assert from "node:assert/strict";
import test from "node:test";
import crypto from "node:crypto";
import { gunzipSync } from "node:zlib";
import { buildStandaloneCanvasRuntime, encodeStandaloneDownload } from "../../src/server/standalone-canvas-runtime";
import { renderStandaloneSlideDocumentHtml, standaloneScript, standaloneStyles } from "../../packages/slide-engine/src/standalone";
import { renderStandaloneCanvas, rewriteStandaloneSvg, STANDALONE_CANVAS_CSP } from "../../packages/slide-engine/src/standalone-canvas";
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

// No DOM parser dependency is installed. This small structural fixture exercises
// the production tree-mutation algorithm; the browser test verifies real pixels.
class SvgNode {
  parent: SvgNode | null = null;
  childNodes: SvgNode[] = [];
  attributes: Map<string, string>;
  localName: string;
  constructor(localName: string, attributes: Record<string, string> = {}, children: SvgNode[] = []) {
    this.localName = localName;
    this.attributes = new Map(Object.entries(attributes));
    for (const child of children) { child.parent = this; this.childNodes.push(child); }
  }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string) { this.attributes.delete(name); }
  contains(node: SvgNode): boolean { return node === this || this.childNodes.some((child) => child.contains(node)); }
  querySelectorAll(selector: string): SvgNode[] {
    return this.childNodes.flatMap((child) => [
      ...(selector === "*" || selector === child.localName || (selector === "[id]" && child.getAttribute("id") !== null) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
  replaceWith(...nodes: SvgNode[]) {
    const owner = this.parent;
    if (!owner) return;
    let position = owner.childNodes.indexOf(this);
    owner.childNodes.splice(position, 1);
    this.parent = null;
    for (const node of nodes) {
      if (node.parent) node.parent.childNodes.splice(node.parent.childNodes.indexOf(node), 1);
      owner.childNodes.splice(position++, 0, node);
      node.parent = owner;
    }
  }
}

test("nested native anchors preserve their transformed group, z-order and exactly one embed", () => {
  const href = "https://learnordie.invalid/embed/native-html";
  const inner = new SvgNode("a", { href });
  const transformed = new SvgNode("g", { transform: "translate(750 150) rotate(12 325 125)", "clip-path": "url(#clip)" }, [inner]);
  const outer = new SvgNode("a", { href }, [transformed]);
  const before = new SvgNode("path");
  const after = new SvgNode("text");
  const svg = new SvgNode("svg", {}, [before, outer, after]);
  const foreign = new SvgNode("foreignObject");
  const calls: string[] = [];
  const count = rewriteStandaloneSvg(svg as unknown as SVGSVGElement, (id) => { calls.push(id); return foreign as unknown as SVGElement; });
  assert.equal(count, 1);
  assert.deepEqual(calls, ["native-html"]);
  assert.deepEqual(svg.childNodes, [before, transformed, after]);
  assert.equal(transformed.getAttribute("transform"), "translate(750 150) rotate(12 325 125)");
  assert.equal(transformed.getAttribute("clip-path"), "url(#clip)");
  assert.deepEqual(transformed.childNodes, [foreign]);
  assert.equal(svg.contains(inner), false);
  assert.equal(svg.querySelectorAll("a").length, 0);
});

test("native symbol/use references survive href cleanup but external and missing references do not", () => {
  const image = new SvgNode("image", { href: "data:image/png;base64,aGVsbG8=" });
  const symbol = new SvgNode("symbol", { id: "image:K_1-test" }, [image]);
  const use = new SvgNode("use", { href: "#image:K_1-test" });
  const xlinkUse = new SvgNode("use", { "xlink:href": "#image:K_1-test" });
  const external = new SvgNode("use", { href: "https://denied.invalid/file.svg#image:K_1-test", "xlink:href": "javascript:alert(1)" });
  const missing = new SvgNode("use", { href: "#missing" });
  const unsafeImage = new SvgNode("image", { href: "data:text/html;base64,aGVsbG8=" });
  const svg = new SvgNode("svg", {}, [new SvgNode("defs", {}, [symbol]), use, xlinkUse, external, missing, unsafeImage]);
  assert.equal(rewriteStandaloneSvg(svg as unknown as SVGSVGElement, () => null), 0);
  assert.equal(use.getAttribute("href"), "#image:K_1-test");
  assert.equal(xlinkUse.getAttribute("xlink:href"), "#image:K_1-test");
  assert.equal(image.getAttribute("href"), "data:image/png;base64,aGVsbG8=");
  for (const node of [external, missing, unsafeImage]) {
    assert.equal(node.getAttribute("href"), null);
    assert.equal(node.getAttribute("xlink:href"), null);
  }
});
