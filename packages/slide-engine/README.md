# @learnordie/slide-engine

Internal learnordie slide runtime package.

This package is the canonical home for the reveal.js-derived presentation core, the controlled learnordie renderer, the CSS contract, QA hooks and the standalone runtime.

The Next.js app consumes this package through the `@learnordie/slide-engine` workspace dependency. App-level components may adapt product data into `SlideDocument`, but schema, renderer, fixtures and engine contracts live here.

## Rules

- The package lives in the `metric-space-ai/learnordie` monorepo.
- It is not a separate product repository.
- reveal.js code is vendored only as selected core modules.
- Every copied upstream path is tracked in `NOTICE.md` and `vendor/reveal-core/UPSTREAM.md`.
- No unsanitized free HTML becomes the slide source of truth.
- Browser QA must cover desktop, tablet and mobile before replacing `SlideCanvas`.
