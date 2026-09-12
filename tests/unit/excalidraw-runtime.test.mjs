import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const runtimeUrl = new URL("../../src/lib/excalidraw-runtime.ts", import.meta.url);
let sequence = 0;

function harness({ failStyle = false, failScript = false, failFont = false, earlyModuleLoad = false } = {}) {
  const counts = { scripts: 0, styles: 0, fonts: 0, mounts: 0, unmounts: 0 };
  const listeners = new Map();
  const nodes = new Map();
  const updates = [];
  let exportOptions;
  const mockRuntimeModule = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    convertToExcalidrawElements: (elements) => elements.map((item, i) => ({ id: `element-${i}`, ...item })),
    exportToSvg: async (options) => { exportOptions = options; return {}; },
    mountExcalidraw: (_host, props) => {
      counts.mounts++; updates.push(props);
      return { update(next) { updates.push(next); }, unmount() { counts.unmounts++; } };
    },
  };
  global.window = { location: { origin: "https://learnordie.example" }, setTimeout, clearTimeout };
  global.document = {
    getElementById: (id) => nodes.get(id),
    createElement: (tag) => ({ tag, dataset: {}, remove() { nodes.delete(this.id); } }),
    head: { append(node) {
      nodes.set(node.id, node);
      if (node.tag === "script") {
        counts.scripts++;
        assert.match(node.src, /^\/learnordie-excalidraw-loader\.mjs\?/);
        queueMicrotask(() => {
          if (failScript) { failScript = false; node.onerror?.(); }
          else if (earlyModuleLoad) {
            node.onload?.();
            setTimeout(() => {
              window.__learnordieCanvasModule = mockRuntimeModule;
              window.__learnordieCanvasReady?.(Number(new URL(node.src, window.location.origin).searchParams.get("attempt")));
            }, 10);
          }
          else { window.__learnordieCanvasModule = mockRuntimeModule; node.onload?.(); }
        });
      } else {
        counts.styles++;
        assert.equal(node.href, "/vendor/excalidraw/excalidraw.css");
        queueMicrotask(() => {
          if (failStyle) { failStyle = false; node.onerror?.(); }
          else node.onload?.();
        });
      }
    } },
    fonts: {
      load: async () => { counts.fonts++; if (failFont) { failFont = false; throw Error("font offline"); } return [{}]; },
      addEventListener: (name, fn) => listeners.set(name, fn),
      removeEventListener: (name) => listeners.delete(name),
    },
  };
  return { counts, updates, listeners, get exportOptions() { return exportOptions; } };
}

async function freshRuntime() { return import(`${runtimeUrl.href}?unit=${++sequence}`); }

test("SSR rejects explicitly without starting a network load", async () => {
  delete global.window;
  const { loadCanvasRuntime } = await freshRuntime();
  await assert.rejects(loadCanvasRuntime(), /Browser/);
});

test("concurrent native runtime requests share modules, styles and required font loading", async () => {
  const { counts } = harness();
  const { loadCanvasRuntime } = await freshRuntime();
  const first = loadCanvasRuntime();
  assert.equal(first, loadCanvasRuntime());
  const runtime = await first;
  assert.equal(runtime, await loadCanvasRuntime());
  assert.deepEqual(counts, { scripts: 1, styles: 1, fonts: 1, mounts: 0, unmounts: 0 });
  assert.equal(window.EXCALIDRAW_ASSET_PATH, "https://learnordie.example/vendor/excalidraw/");
});

test("first load waits for dynamic module evaluation after script load, without manual retry", async () => {
  const { counts } = harness({ earlyModuleLoad: true });
  const { loadCanvasRuntime } = await freshRuntime();
  const runtime = await loadCanvasRuntime();
  assert.equal(typeof runtime.mountExcalidraw, "function");
  assert.equal(counts.scripts, 1);
  assert.equal(window.__learnordieCanvasReady, undefined);
});

for (const failure of ["failStyle", "failScript", "failFont"]) {
  test(`${failure}: load fails visibly and an explicit retry succeeds without duplicating successful assets`, async () => {
    const { counts } = harness({ [failure]: true });
    const { loadCanvasRuntime } = await freshRuntime();
    await assert.rejects(loadCanvasRuntime());
    await loadCanvasRuntime();
    assert.equal(counts.scripts, failure === "failScript" ? 2 : 1);
    assert.equal(counts.styles, failure === "failStyle" ? 2 : 1);
  });
}

test("mount locks down external embeds and AI, forwards updates, and unmounts once", async () => {
  const h = harness();
  const { loadCanvasRuntime } = await freshRuntime();
  const runtime = await loadCanvasRuntime();
  const mount = runtime.mountExcalidraw({}, { aiEnabled: true, validateEmbeddable: () => true, renderEmbeddable: () => null });
  assert.equal(h.updates[0].aiEnabled, false);
  assert.equal(h.updates[0].validateEmbeddable("https://youtube.com/watch?v=123"), false);
  assert.equal(h.updates[0].validateEmbeddable("https://learnordie.invalid/embed/a-b"), true);
  assert.ok(h.updates[0].renderEmbeddable({}, {}));
  mount.update({ name: "Updated slide" });
  assert.equal(h.updates[1].name, "Updated slide");
  mount.unmount(); mount.unmount(); mount.update({});
  assert.equal(h.counts.unmounts, 1);
  assert.equal(h.updates.length, 2);
  assert.equal(h.listeners.size, 0);
});

test("custom elements receive inert sentinel links and SVG never exports live iframes", async () => {
  const h = harness();
  const { loadCanvasRuntime, isCanvasEmbedLink } = await freshRuntime();
  const runtime = await loadCanvasRuntime();
  const [element] = runtime.convertToExcalidrawElements([{ type: "embeddable", customData: { learnordie: { type: "html", html: "<p>Hello</p>" } } }]);
  assert.ok(isCanvasEmbedLink(element.link));
  for (const link of [null, "javascript:alert(1)", "https://learnordie.invalid.evil/embed/a", "https://learnordie.invalid/embed/a?redirect=evil"]) assert.equal(isCanvasEmbedLink(link), false);
  await runtime.exportToSvg({ elements: [element], renderEmbeddables: true });
  assert.equal(h.exportOptions.renderEmbeddables, false);
});

test("vendored module closure is local and all imported chunks exist", () => {
  const vendor = resolve(root, "public/vendor/excalidraw");
  for (const filename of ["runtime.mjs", "excalidraw.mjs", "subset-worker.chunk.js", "subset-shared.chunk.js", "chunk-EIO257PC.js", "chunk-SRAX5OIU.js"]) {
    const source = readFileSync(resolve(vendor, filename), "utf8");
    for (const match of source.matchAll(/(?:from\s*|import\s*)["'](\.\/[^"']+)["']/g)) {
      assert.ok(existsSync(resolve(vendor, match[1])), `${filename}: missing ${match[1]}`);
    }
    assert.doesNotMatch(source, /(?:from\s*|import\s*)["']https?:/);
  }
  const engine = readFileSync(resolve(vendor, "excalidraw.mjs"), "utf8");
  assert.match(engine, /"ASSETS_FALLBACK_URL",new URL\("\.\/",import.meta.url\).href/);
  assert.doesNotMatch(engine, /"ASSETS_FALLBACK_URL",`https?:/);
});

test("HTML sidecar security contract is scripts-off opaque sandbox with no app DOM insertion", () => {
  const source = readFileSync(resolve(root, "src/components/excalidraw/CanvasEmbed.tsx"), "utf8");
  assert.match(source, /CANVAS_HTML_SANDBOX = ""/);
  assert.match(source, /script-src 'none'/);
  assert.match(source, /connect-src 'none'/);
  assert.match(source, /form-action 'none'/);
  assert.match(source, /base-uri 'none'/);
  assert.match(source, /MAX_CANVAS_HTML_LENGTH = 65_536/);
  assert.doesNotMatch(source, /allow-scripts|allow-same-origin|dangerouslySetInnerHTML/);
  assert.match(source, /template\.innerHTML = html/);
  assert.doesNotMatch(source, /append\(template|appendChild\(template/);
  assert.match(source, /queueMicrotask\(\(\) => ownedRoot\.unmount\(\)\)/);
});
