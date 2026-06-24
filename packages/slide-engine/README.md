# @learnordie/slide-engine

Internal learnordie slide runtime package.

This package is the canonical home for the reveal.js-derived presentation core, the controlled learnordie renderer, the CSS contract, QA hooks and the standalone runtime.

The Next.js app consumes this package through the `@learnordie/slide-engine` workspace dependency. App-level components may adapt product data into `SlideDocument`, but schema, renderer, fixtures and engine contracts live here.

## Rules

- The package lives in the `metric-space-ai/learnordie` monorepo.
- It is not a separate product repository.
- reveal.js code is vendored only as selected core modules under `vendor/reveal-core/src`.
- Every copied upstream path is tracked in `NOTICE.md` and `vendor/reveal-core/UPSTREAM.md`.
- No unsanitized free HTML becomes the slide source of truth.
- Browser QA must cover desktop, tablet and mobile before replacing `SlideCanvas`.
- Standalone exports must be rendered from `SlideDocument` through the package exporter, not from app-local legacy HTML.

## Vendor Commands

- `npm run vendor:reveal-core` imports the pinned reveal.js `6.0.1` core snapshot.
- `npm run check:slide-engine-vendor` verifies the upstream commit, copied paths and excluded demo/plugin/theme paths.

The vendored upstream source is treated as third-party reference/runtime material. Product code should use the typed learnordie exports from this package instead of importing arbitrary files from `vendor/`.

## Standalone Runtime

`src/standalone.ts` renders a validated `SlideDocument` into self-contained HTML for long-term offline use. The exported document embeds the slide data JSON, manifest JSON, package CSS, package interaction script, optional inline audio sources and quiz feedback logic.

## Agentic Editing Runtime

`src/editing.ts` exposes the structured edit contract for agents and the future WYSIWYG editor. It applies batches of operations against stable `slideId`, `blockId`, `assetId`, `noteId` and `anchorId` targets, then validates the full `SlideDocument` before returning an accepted document.

Agents should use this API instead of editing rendered HTML or app-local legacy slide data. Failed operations return repair-oriented issues so the generation loop can retry only the affected slide or block.

## Editor QA

`DeckRenderer` and `SlideRenderer` expose optional block-selection hooks for editor surfaces. The app-level QA route `/slide-engine/qa/editor` uses those hooks together with `applySlideDocumentEdits` to prove text edits, layout changes, figure asset replacement, formula edits, quiz-anchor updates and invalid-patch repair feedback in a real browser.
