# Modell-Import: aktuelle Originalvorlesung

The explicit `POST /api/lectures/model-demo` now imports the full original lecture
with a new owner/version key, never overwriting the earlier example. See
[model-original-conversion.md](model-original-conversion.md) for the current
contract, source inventory, coverage, readable notes and verification boundaries.

## Historical v1 example (not the current endpoint template)

The following records the previous implementation. Its factory remains for
compatibility tests; no existing example data is migrated or replaced.

## Integration

Wire the `Modell-Slides hinzufügen` button in LecturerDashboard to an explicit
`POST /api/lectures/model-demo` request with the existing
lecturer session cookie and CSRF header. Omit the request body entirely.

- `201 { lectureId, created: true }`: created an owned draft and eight slides.
- `200 { lectureId, created: false }`: existing owned example, untouched.
- `401`: session missing or invalid; `403`: normal CSRF check failed.
- `400`: body supplied; this route accepts no owner, source or template input.
- `503`: unavailable persistence or failed transaction; response contains no DB details.

Refresh the existing owner-scoped `GET /api/lectures` and select `lectureId`.
Do not invoke on login, page load, GET, mount or seed initialization.
This route requires PostgreSQL; there is no local-JSON fallback or automatic seed.

## Source and provenance

`packages/slide-engine/src/scenes/modell-factories.ts` contains
the eight Three.js scenes `modell.morph`, `modell.miniature`, `modell.law`,
`modell.limits`, `modell.runtime`, `modell.learning`, `modell.language`, and
`modell.transfer`. Its header identifies a verbatim port from
`Modellbegriff_ThreeJS_clean.html`.
`modell-state.ts` contains synthetic training data, language illustration
probabilities and didactic state logic. The inspected tracked source did not
include the original HTML/full lecture deck; this does not establish whether an
original exists in other storage. The existing block fixture uses only `modell.law`.

The new template is titled **Der Modellbegriff im Wandel – Beispielsatz**.
It supplies newly authored German teaching text, exploration prompts, source
references and notes for all eight existing scenes. It does not claim recovery
of the original lecture. Language probabilities are explicitly described as
illustrations; the learning scene uses synthetic data. No account data is a source.
Canonical `scene3d` blocks use existing native conversion without runtime edits.

## Persistence and scope

Only the authenticated session email determines ownership. A stable versioned
owner-derived UUID identifies the lecture, its private series and its eight slide
rows. The public token is random and does not encode the email. One transaction
uses a PostgreSQL advisory transaction lock on that lecture identity, checks the
owner through series/users, and inserts the series, draft, document and slide rows.
Stable primary keys provide a second duplicate guard. Repeated calls return the
same ID even after title, content or status edits; no existing content is reset.
The series is never adopted by title. A series ownership mismatch fails closed.
The service does not call repository initialization, seed helpers or standard
createLecture (which would create unrelated default content/questions).

There are no schema changes, global resets, questions, join codes, enrollment
changes or existing owner transfers. Creation is draft-only with leaderboard off.
The nullable `live_at`, `exam_date` and `ai_access_until` columns are omitted on
creation and remain NULL in storage. Existing repository read normalization can
still supply display defaults; this endpoint does not schedule a lecture or exam.
Slide rows use the repository's one-based `position`, `title`, and `content_json`
fields (`eyebrow`, `topic`, `copy`, `diagram`). Their UUIDs match the canonical
document's slide IDs. Other normal authorization/public-link behavior remains
governed by the existing application.

## Verification boundaries

The focused test command is:

```sh
node --experimental-strip-types --import ./scripts/alias-register.mjs --test --test-concurrency=1 src/server/model-demo.test.ts
```

Tests validate all eight canonical/native-convertible slides, reject unauthenticated,
CSRF-invalid and body-bearing requests before persistence, verify session identity
and sanitized failures, and check SQL parameterization/owner predicates, repeated
creation, separate owners and rollback/retry using a recording transaction double.
The double serializes transactions; it does not prove real PostgreSQL concurrency.
Integration verification must additionally cover real session/CSRF handling,
PostgreSQL locking and rollback, and the rendered slides. These unit tests do not
establish browser, build or live database behavior. Run persistence integration
checks against an authorized isolated test database.
