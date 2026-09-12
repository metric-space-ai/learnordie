# Live classroom synchronization

Live mode uses PostgreSQL, not process memory or a browser's local slide index. Apply migration `0028_live_sessions` after the existing migrations before using live mode. No scheduler, worker or persistent WebSocket service is required on Vercel.

## Contract

- An owner opens `/lecturer/live/:token`. A never-started lecture starts at the QR welcome slide. Reload resumes the existing session; an ended session requires explicit restart. The Back/Next controls and Space/Quiz button issue version-checked server commands. Previous from slide 1 returns to the QR intro. Beenden ends the session for everybody before leaving.
- Students open `/l/:token` without a name/account gate. They follow the presenter's intro/slide and cannot independently broadcast, navigate the live deck or start an unsent question. Use `/learn/:token` for independent practice.
- Each fire command snapshots exactly one family (all its difficulty variants) and gives it a unique round ID and absolute PostgreSQL wall-clock deadline. Teacher family selection includes newly generated STT families. Students choose difficulty, not a different unsent family.
- Answers use the httpOnly student cookie and an active series enrollment. The session row lock, deadline check, unique round/profile constraint, receipt, participant link and analytics event belong to one transaction. Changing difficulty, reloading or retrying cannot award extra points. Legacy `mode: live` answers to `/api/events` are rejected. Practice events remain separate.
- Public snapshots contain only question/option text, points, slide/intro/status and the caller's own receipt. They never broadcast answer keys, another student's response, explanations before answering, transcripts or speaker notes. Presentation page and control writes enforce lecturer ownership.
- The session scoreboard counts only valid answers from that session. Opening it enables polling; it updates while open. Practice/historical scoreboard remains on its existing endpoint and learn UI.
- Clients make one request at a time, normally every 1.5 seconds (4 seconds in hidden tabs), with a 5-second timeout. Returning online/visible triggers refresh. Connection loss hides answer controls. Response timing uses request start conservatively, and the visible round deadline is monotonic: slow responses cannot grant extra time. The server remains authoritative even if a client is modified.

## Local mode and safety

An application started without `DATABASE_URL` can still serve independent local practice. Synchronized live controls explicitly report that PostgreSQL is required; there is no misleading process-local fallback pretending to synchronize different Vercel instances. Use the existing hosted E2E environment or a resource-gated isolated local PostgreSQL instance for live tests.

`scripts/live-smoke.mjs` verifies public live viewing and reload only; it does not answer questions or control an arbitrary class. Its report explicitly excludes live answer/control proof. Use the dedicated Playwright suite for browser evidence.

`scripts/live-load-smoke.mjs` requires an explicit `--lecture-token`, `--own-test-lecture`, and a private `--session-file` JSON containing `{ "cookie": "…", "csrfToken": "…" }`. Never put credentials in CLI arguments, artifacts or commits. The account must own that disposable lecture. Public targets additionally require HTTPS and `--allow-public-write`. The script refuses an already-active session, runs at most two concurrent API requests, creates legitimate enrollments/rounds, compares exact receipts/scores, and ends only the session it started if no competing controller has changed it. A failed cleanup is reported, never silently ignored.

## Verification

`tests/e2e/live-session-sync.spec.ts` is included by the existing hosted Playwright gate. It uses real PostgreSQL and one Chromium process with one lecturer and three isolated student contexts (one mobile), real email-code fixture login, late join/reload, duplicate responses, no solution broadcast, alias claims, live scoreboard updates, expiry/offline/reconnect/end/restart, cross-tenant denial, a real SQL lock held through expiry, and a close/answer concurrency race. It attaches structured evidence only after successful assertions.

The historical smoke tests retain chat moderation/rate limits and 30-person top-10/self ranking assertions. The API load fixture uses authenticated real live rounds for 116 participant answers and 12 anchor answers instead of forging events.

Writing tests is not execution evidence. Consult the PR's hosted run results and attached report; do not label this production ready until those and representative preview-browser stories pass.
