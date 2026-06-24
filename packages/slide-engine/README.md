# @learnordie/slide-engine

Internal learnordie slide runtime package.

This package is the canonical home for the reveal.js-derived presentation core, the controlled learnordie renderer, the CSS contract, QA hooks and the standalone runtime.

The current spike may keep app adapters in `src/slide-engine` while schema and renderer contracts settle. Reusable runtime code moves here before it becomes a stable product dependency inside the app.

## Rules

- The package lives in the `metric-space-ai/learnordie` monorepo.
- It is not a separate product repository.
- reveal.js code is vendored only as selected core modules.
- Every copied upstream path is tracked in `NOTICE.md` and `vendor/reveal-core/UPSTREAM.md`.
- No unsanitized free HTML becomes the slide source of truth.
- Browser QA must cover desktop, tablet and mobile before replacing `SlideCanvas`.
