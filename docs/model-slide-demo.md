# Modell-Slides als persönlicher Beispielsatz

## Integration

The parent adds the `Modell-Slides hinzufügen` button in LecturerDashboard.
On an explicit click, send `POST /api/lectures/model-demo` with the existing
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

At `9d34ea6`, `packages/slide-engine/src/scenes/modell-factories.ts` contains
the eight Three.js scenes `modell.morph`, `modell.miniature`, `modell.law`,
`modell.limits`, `modell.runtime`, `modell.learning`, `modell.language`, and
`modell.transfer`. Its header identifies a verbatim port from
`Modellbegriff_ThreeJS_clean.html`; commit
`5007f2aacb6353805780f0ec1f07dbb4cba30336` introduced the port.
`modell-state.ts` contains synthetic training data, language illustration
probabilities and didactic state logic. The tracked files do not contain the
original HTML/full lecture deck. The existing block fixture uses only `modell.law`.

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
Dates are intentionally unscheduled. Other normal authorization/public-link
behavior remains governed by the existing application.

## Verification boundaries

The focused test command (run through the coordinated host gate) is:

```sh
node --experimental-strip-types --import ./scripts/alias-register.mjs --test --test-concurrency=1 src/server/model-demo.test.ts
```

Tests validate all eight canonical/native-convertible slides, reject unauthenticated,
CSRF-invalid and body-bearing requests before persistence, verify session identity
and sanitized failures, and check SQL parameterization/owner predicates, repeated
creation, separate owners and rollback/retry using a recording transaction double.
The double serializes transactions; it does not prove real PostgreSQL concurrency.
Live CSRF/session integration, real locking/rollback and visual behavior belong to
the parent's coordinated QA run. No browser, build or live DB validation is claimed.

No production database or private configuration was accessed by this sidecar.
No database was mutated. If the parent runs persistence validation, only its
authorized isolated `learnordie_qa_m1_20260912` database is in scope.
Dashboard, editor, CSS and runtime changes are deliberately left to the parent.
