# Native Excalidraw runtime and sidecars

## Integration contract

Import `loadCanvasRuntime`, `CanvasRuntime`, and `CanvasImperativeAPI` from
`@/lib/excalidraw-runtime`; import `renderCanvasEmbeddable` from
`@/components/excalidraw/CanvasEmbed`. Load client-side, catch the returned
promise and show its German error message with an explicit retry button.

```tsx
const runtime = await loadCanvasRuntime();
const mount = runtime.mountExcalidraw(host, {
  initialData: { elements, appState, files },
  excalidrawAPI: (api) => { apiRef.current = api; },
  onChange: (elements, appState, files) => persist(elements, appState, files),
  renderEmbeddable: (element) => renderCanvasEmbeddable(runtime, element),
});
// Update props without destroying the editor or interactive scene state:
mount.update(nextProps);
// On slide change/unmount:
mount.unmount();
```

`update` replaces props (not a merge). Scene changes use the imperative
`updateScene` API; `initialData` is initial data, not a controlled scene prop.
Imperative API: `getSceneElements`, `getAppState`, `getFiles`, `updateScene`,
`scrollToContent`, `setActiveTool`, `addFiles`, `refresh`.

Runtime methods also include `convertToExcalidrawElements(elements, options?)`,
`exportToSvg(options)` and vendor-React `createElement(type, props, ...children)`.
The converter forwards native conversion and gives custom embeddables an inert
`https://learnordie.invalid/embed/<encoded-element-id>` link. Initial/imported
scenes must also carry this sentinel. The URL is only an internal validation
marker and is never requested. **Excalidraw 0.18 `validateEmbeddable` receives
a URL string, not an element.** The wrapper enforces the sentinel allowlist,
disables AI/collaboration integrations, and forbids null renderer fallthrough.

Mount a native editor in a positioned host with non-zero width and height.
The runtime installs local CSS once; exclude `public/vendor/excalidraw/**` from
application lint. Preserve the existing slide-engine core CSS for three.js
scene controls. Font loads fail visibly and can be retried; a browser-cached
module/font network failure may require the offered page reload.

## Embed schema and ownership

`type: "embeddable"`, with `customData.learnordie` containing one of:

```json
{"type":"scene3d","sceneId":"modell.learning","caption":"Lernen","accent":"#8fcfc2"}
```

```json
{"type":"html","html":"<style>h2{color:#765080}</style><h2>HTML/CSS</h2>","title":"HTML/CSS-Inhalt"}
```

Scene IDs must be one of the existing engine's `scene3dSceneIdValues`. The sidecar
reuses `Scene3DBlockRenderer`: lazy actual three.js/WebGL, existing interactive
controls, reduced-motion behavior, fallback, and destroy/cancel-frame cleanup.
Narrow previews retain that renderer's 2D fallback rather than consuming WebGL
contexts for every thumbnail. Its DOM root is separate from vendor React.
A stable, hooks-free class adapter receives vendor lifecycle events; nested
main-React root cleanup occurs after the vendor commit via a microtask.

## HTML safety boundary

HTML/CSS only, maximum **65,536 characters**, nesting depth at most 32. Scripts
are intentionally unsupported. Arbitrary iframe JavaScript cannot be promised
network-free because browsers do not reliably block self-navigation with CSP.
Interactive behavior belongs in the controlled three.js scenes.

HTML is parsed into an inert detached template, allowlisted and serialized;
that template is never inserted into the app DOM. Scripts/event handlers,
links, forms, base/meta refresh, nested frames, remote images and active SVG
are discarded. The resulting `srcdoc` iframe has **empty sandbox permissions**:
no scripts, same-origin access, forms, popups, top navigation or app DOM access.
An early CSP blocks all network by default; inline CSS and raster data images
are allowed. User CSS remains inside that frame. No messaging protocol exposes
app state or secrets. Static SVG export deliberately disables embeddable DOM;
it is not a snapshot of live WebGL or HTML.

## Evidence and remaining integration gate

Focused unit command:

```sh
greppy bash-smart -- node --experimental-strip-types --test --test-concurrency=1 tests/unit/excalidraw-runtime.test.mjs
```

Nine contracts passed: browser-only load, shared concurrent loading, independent
style/script/font failure recovery, deny-external embed policy, mount/update/
single unmount, inert links/static exports, closed local import graph, and the
HTML scripts-off boundary. TypeScript/TSX syntax transpilation passed. These
are not a full semantic typecheck, a security audit, or production UI proof.

`tests/e2e/excalidraw-runtime.spec.ts` runs the actual production sanitizer in a
browser-native test module and verifies styling, blocked markup/network/parent
access and the size limit. It is prepared but not executed by this worker.
Run it under the shared heavy-job gate with the parent integration suite.
Parent must also verify native text creation/edit/persistence/reload, switching
slides, no duplicate React/hook errors, an actual interactive WebGL scene and
cleanup, HTML confinement, local font failure/retry, and static SVG export.

No dependency install, application build, standalone browser, or server is
started by this worker. No credentials, production configuration, or canonical
dirty checkout files are changed.
