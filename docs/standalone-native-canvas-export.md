# Native canvas in standalone/offline lecture exports

## What is preserved

For a slide with `canvas`, the canvas is authoritative. The export no longer
renders its stale semantic `blocks`. Full original native element geometry,
typography, bindings, frames, raster files and embed payloads remain in the
data JSON. The read-only offline view uses **the supplied native Excalidraw SVG
exporter**, not a second approximate shape/text renderer.

Native SVG retains rough shapes, arrows, freehand paths, text and embedded
rasters. The export replaces native embed anchor placeholders **in place**,
retaining their native transform, ordering and frame clipping:

- HTML/CSS: the same scripts-off, detached-template allowlist contract as the
  application, rendered inside an opaque empty-permission `srcdoc` sandbox.
  Links, forms, refresh, scripts, event attributes and external images/frames
  are removed; CSP blocks network. Author JavaScript is not supported.
- 3D: existing engine-generated 2D snapshots, visibly labelled static and
  non-interactive. This export does not contain a live WebGL application.

Legacy slides without a canvas continue using their existing semantic renderer.

## Fully local distribution

`src/server/standalone-canvas-runtime.ts` verifies the vendored module, every
included font and licence notice against `PROVENANCE.json`. It replaces local
font references with embedded data URLs and packages the closed module as gzip
base64. A small browser-native module uses `DecompressionStream` and a temporary
local Blob module URL. There is **no eval, CDN, external editor, runtime module
download or local-file ESM import**. Consequently the single downloaded HTML
and ZIP's `index.html` can work from `file://` without serving a directory.
The Blob URL is revoked after import.

Measured initial payload:8,883,094 uncompressed bytes;3,979,466 bytes for the
compressed-module bootstrap,25 font files and39,989 licence/notice bytes.
The complete notices are embedded as escaped inert details and additionally
distributed as a text entry in ZIP. The ZIP does not duplicate the runtime;
its manifest identifies the inline module inside `index.html`.

Next's export function tracing must include `./public/vendor/excalidraw/**/*`
for `/api/lecture/*/export`. The parent owns that deployment configuration.
Missing, altered or incompatible assets produce a visible HTTP503 export
error, never a deceptively successful stale-block export.

HTML and ZIP downloads negotiate ordinary HTTP gzip where accepted. Hashes
refer to the exact **decoded download** bytes, unchanged by content encoding.
Native responses exceeding4MiB after negotiated encoding return an explicit
HTTP413 advising smaller lectures/assets; no elements are dropped. Storage,
production configuration and general ZIP encoding are not changed.

## Limits and failure behavior

- A modern browser supporting native modules, SVG/foreignObject and
  `DecompressionStream` is required. An unsupported browser gets a visible
  failure, with current canvas text and complete original data retained.
- Native rendering is sequential, with a20-second bound per slide and a
  startup timeout. Failed/missing embed rendering is explicit, not silently
  omitted. No stale legacy content is substituted.
- The supplied archive lacks Xiaolai CJK font assets. Those absent URLs are
  replaced with inert empty data resources rather than remote fallbacks;
  missing glyphs depend on available browser/system fallback fonts. The
  export explicitly discloses this, rather than claiming universal fidelity.
- Server AI, live synchronization, analytics, editing and live WebGL are not
  part of the offline artifact. Original canvas JSON remains available.
- Large images/audio can still exceed the bounded serverless download budget;
  the explicit413 is intentional and does not authorize broader storage work.

## Verification

Focused unit command (one worker, existing dependencies, no install):

```sh
greppy bash-smart -- node --experimental-strip-types --import ./scripts/alias-register.mjs --test --test-concurrency=1 tests/unit/standalone-native-export.test.ts
```

Contracts cover verified closure/font inventory and decompressed bytes,
authoritative canvas preservation, unsupported-runtime safeguards, isolation,
deleted elements, script-closing/quoted-URL escaping, licences and exact gzip
download round trips/budget rejection. Syntax transpilation passed; it is not
a full semantic typecheck.

`tests/e2e/standalone-native-export.spec.ts` is prepared for the parent's gated
browser run: true native SVG, raster, safe HTML/CSS, static3D, no network,
mobile overflow and unsupported-browser failure. **Not yet browser-verified**
by this worker; parent integration/release gates remain required.
