# Native Excalidraw slide engine — integration in progress

## Source and direction

The supplied `excalidraw-business-os-source.zip` is the integration source. Its
locally bundled Excalidraw0.18 runtime and fonts are adapted inside Learnordie;
the surrounding Business OS/Grok application, authentication and data layer are
not imported. Vendor provenance and licensing live alongside the runtime.

Visual direction: a quiet warm-white drawing surface, organic editable text and
shapes, one muted green accent. The canvas is the primary workspace; lecture
navigation, material/question tools and save controls remain outside it. Tool
hover states, brief inspector transitions and deliberate fit-to-canvas motion
provide feedback, respecting reduced motion.

## Data and behavior

- A slide may contain a versioned native canvas scene within its existing
  SlideDocument. Native text remains editable text, not a screenshot.
- Existing structured slides are converted into native elements on entry.
  Conversion must preserve content, stable IDs, question anchors and sources.
- Scene edits use the existing authenticated lecturer save path and PostgreSQL
  JSON storage. Browser local storage is not the durable source of truth.
- Both live presentation and independent learning use the same native scene.
  Read-only scenes expose non-deleted native text in a screen-reader region;
  drawing text is not reduced to inaccessible pixels alone.
  The separate server-authoritative live session controls slide index, question
  rounds and scoring; the engine does not introduce a second scoring system.
- Each new live session retains the QR welcome slide and written join URL.
  The lecture link remains visible above the canvas.
- Three.js elements use controlled, registered interactive scenes and may be
  positioned/resized with Excalidraw. HTML/CSS elements run in an opaque sandbox;
  arbitrary scripts, forms and external network access are not supported.

## Required release evidence

Before calling this migration complete, verify real UI text creation/editing,
save/reload, shape movement, three.js rendering and disposal, HTML sandboxing,
existing slide conversion, mobile fit, lecturer isolation, and one lecturer with
three independent live students. A build or source-level unit test is not this
browser evidence. Existing offline export, agent-edit and fixture coverage must
be assessed explicitly rather than silently declared compatible.

Integrated candidate `dff7e5f` passed ESLint without errors or warnings, all55
unit contracts and the Next.js/TypeScript build on an isolated preview. Native
offline export now preserves vector/text/image content and sandboxed HTML,
with explicitly static three.js snapshots; its actual offline browser cases
remain unexecuted. See `docs/standalone-native-canvas-export.md` for limits.

The previous engine's live smoke passed its core synchronization flows on
preview58c5006; those results do not certify this replacement engine. Production
merge/deployment remains paused pending the replacement's verification. The
native browser task has been blocked by the shared host admission gate; do not
substitute the unit/build results for native UI, persistence or classroom proof.
