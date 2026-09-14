# Vollständige Originalvorlesung: Modellbegriff

## Explicit import contract

`POST /api/lectures/model-demo` remains authenticated, CSRF-protected and bodyless.
It now imports **Der Begriff „Modell“ im Wandel der Zeit** using identity key
`learnordie:model-original:clean-v2`. First call: `201 {lectureId, created:true}`;
repeat: `200 {lectureId, created:false}`, preserving edits. The owner-scoped
transaction, advisory lock, random public token, draft status, rollback and
no-seeding rules are unchanged. No migrations or database mutations accompany
this code change. The earlier example key `learnordie:model-demo:v1` is not reused.
Existing example/user content remains untouched, including its private series.

The parent Dashboard should name this action “Originalvorlesung importieren”,
refresh its owned lecture list, and select the returned ID. Do not auto-import.
The former example factory remains available and tested, but is no longer this
endpoint's template. Its historical contract remains in `model-slide-demo.md`.

## Authority and source preservation

`packages/slide-engine/src/scenes/modell-factories.ts` explicitly identifies
`Modellbegriff_ThreeJS_clean.html` as the verbatim scene-port source. The supplied
Markdown explicitly describes itself as that eight-part presentation's expanded
companion. Thus the clean HTML is authoritative for authored slide order/content;
the Markdown is the unabridged companion, not an alternative eight-slide template.
`Modellbegriff_ThreeJS.html` has matching headline identities; the differently
titled `Modell-Wandel.html` and `Modell-Wandel-Buehne.html` are not silently mixed in.
No claim is made that this converts all 31 pages of the earlier referenced PDF.
That limitation is stated by the original itself; the companion expands it.

Author snapshots, SHA-256 hashes, all 16 companion sections and line locators are
in `docs/sources/model-original/`. Both full source hashes were checked against
the supplied files. `scripts/import-model-original.mjs` performs a data-only
extraction without evaluating HTML/JS and refuses overwrites. It keeps filenames,
not private filesystem paths. The existing Three.js license remains intact;
the original embedded notice is additionally preserved in `THREE-LICENSE.txt`.
No separate lecture-content license was supplied; no MIT relicensing of the
owner's lecture is asserted.

## Coverage manifest

| # | Exact authored title (line break shown as /) | Existing scene |
|---|---|---|
| 1 | Ein Begriff. / Im Wandel. | modell.morph |
| 2 | Die Welt / im Kleinen. | modell.miniature |
| 3 | Nicht das Ding. / Die Beziehung. | modell.law |
| 4 | Ein Geschehen. / Viele Modelle. | modell.limits |
| 5 | Vom Abbild / zur Wirkung. | modell.runtime |
| 6 | Die Funktion / entsteht. | modell.learning |
| 7 | Das Modell / spricht. | modell.language |
| 8 | Wir gestalten / das Lernen. | modell.transfer |

Each of 8 × 13 authored fields is retained in `model-original-html` source data.
Title, kicker, lead, formula, takeaway and question are separate native editable
text elements. Scene title/subtitle and source are preserved in that source
snapshot, not duplicated around the animation. Scene title/subtitle also form
the accessible scene description, and source references remain attached.
Scene ID/accent map to the existing interactive Three.js embed. Navigation labels remain in the source snapshot;
normal app slide navigation uses the authored title. Original HTML notes become
complete speaker notes, with separate source references. No screenshots or
invented replacement teaching text are used. Redundant static scene labels are
not added to the canvas. The v2 composition reserves an 880 × 760 native scene
area (previously 800 × 540), with 28 px body text in the 1600 × 900 slide.
Text is stacked from measured wrapped element heights, not overlapping fixed
rows. This is a source-coordinate contract; screen readability still requires
browser verification at the actual presentation viewport.

Existing saved v1 canvases are not silently reflowed: differing native elements
or metadata produce an upgrade conflict. The versioned importer does not replace
previous imports or user edits. The guarded migration must be reviewed separately
against the intended lecture before any stored document changes.

The **entire 1,350-line companion** remains byte-exact in `model-original-companion`
sourceDocument structured data, including introduction, chapters 1–8, A–B
deepening sections, C exercises/solutions, D timing/demo guidance, E glossary/
symbols and F references/corrections. It is not squeezed into speaker-note limits
or presented as newly authored slide pages. Original source-dialog text and
reference URLs are retained separately, including its explicit limitations.

## Readable notes and companion (not storage-only)

Authenticated `GET /api/lectures/model-demo/source` downloads the exact Markdown.
`GET /api/lectures/model-demo/source?view=read` presents all eight original notes,
source-dialog text, scholarly reference links and the whole companion in a
responsive text reader. Parent Dashboard exposes the reader and download.
These are immutable source materials, not a view of later user edits. Both paths
require a lecturer session, use no DB or arbitrary filesystem input, and return
private/no-store. Reader content is escaped and scripts/network assets are
prohibited by CSP. The reader renders GFM tables and KaTeX/MathML equations
server-side with trust disabled; the separate Markdown download remains exact.

## Existing control inventory and fidelity limits

The unchanged scene renderer provides: concept 0–4; abstraction 0–1; stiffness
1–9 N/m; force/energy switch; input −1–1 and execution toggle; real gradient
training/start/pause/reset with loss/steps and inference input; two language
contexts, token step and illustrative candidates; all five transfer steps and
their exact explanations. Pause/reset-camera remain existing scene-host actions.
This conversion does not alter any renderer, runtime or general CSS.

Scene controls and physical calculations are independent of this layout change;
the preceding renderer work and its browser acceptance must be tracked separately.
HTML emphasis becomes editable
plain text; θ subscript becomes explicit `p_θ` notation, with original markup in
provenance. These are known typography/dynamic-display differences, not a claim
of pixel-identical reproduction.

## Verification and release boundary

Historical focused gated Node tests: **11 passed**, no DB connection. Coverage includes all
source hashes/companion sections, exact field and note text, valid native schema,
one correctly mapped live embed per slide, no flattened images, pairwise
non-overlapping within-frame element geometry (including lead/formula/takeaway/
question/source order), edit/JSON round-trip preserving provenance, owner/version
isolation, repeat preservation, rollback/retry and source endpoint session denial/
reader/download through mocked session access. Known Node loader deprecation/
module-type warnings remain. Added tests are in the existing identity unit runner.

The v2 layout and migration helper have 14 passing focused Node contracts:
unchanged source hashes and full notes, six editable visible text fields,
accessible uncaptained scene, at least 50% more scene area, within-frame / no
overlap geometry, edit protection, historical import upgrade and backup guards.
These tests do not establish visual or production acceptance.

Parent acceptance on preview `7cfaf74` (2026-09-13): all eight original slides
opened and their concept/abstraction/stiffness/energy/execution/training/language/
transfer controls operated in the internal browser; mobile slide selection and
reader navigation inspected. CI34746266459 passed reader equations/tables/source
downloads and native persistence. Overall CI was 69 passed, 3 failed, with no
skips/flaky cases; this is not a full application or production acceptance.
