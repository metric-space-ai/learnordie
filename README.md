# LearnBuddy

LearnBuddy is a lecture augmentation platform for technical university courses. It combines presentation delivery, live multiple-choice questions, pseudonymous student participation, replay learning, AI explanations, analytics and long-term standalone exports.

The current reference topic is **Maschinenelemente I: Gleitlagerung**.

## Product

LearnBuddy has two primary roles:

- **Lecturers** create lecture series, set join codes, upload material, prepare questions, run live sessions and review learning analytics.
- **Students** join with a link or short code, choose a pseudonym, participate live and later use the Learn mode until the exam date.

The core product principle is: **slides first, tools second**. The presentation remains the central object. Questions, transcripts, chat, leaderboard, evaluation and AI support open contextually around the slide instead of becoming a generic dashboard.

## Key Features

- Pseudonymous student participation without account friction.
- Lecturer Magic-Link login through Resend.
- Human join codes such as `ME1-GL-2026`.
- Live lecture mode with instant answer feedback and leaderboard.
- Learn mode with slide hotspots, question density, AI chat and replay.
- Four question levels from `4.0` to `1.0`, mapped to 1-4 points.
- Material pipeline for PDF, PowerPoint, URLs and notes.
- Realtime transcript ingestion path for browser microphone/STT.
- Anonymous analytics and readiness feedback for exam preparation.
- Standalone export for long-term offline use.
- Vercel/Neon/Resend deployment, with self-hosting path documented.

## Stack

- Next.js App Router
- React 19
- TypeScript
- Postgres with Drizzle ORM
- Neon for managed Postgres
- Vercel for deployment
- Resend for lecturer magic links
- Playwright for browser release gates

## Local Development

```bash
npm install
cp .env.example .env
npm run dev
```

Default local development can use the local JSON store. For Postgres-backed development, set:

```bash
LEARNBUDDY_REPOSITORY=postgres
DATABASE_URL=postgres://...
```

Run migrations:

```bash
npm run db:migrate
```

Seed the reference lecture:

```bash
npm run admin -- seed-demo --owner referent@example.test
```

The seed creates the public lecture token `gleitlagerung-demo` and the student join code `ME1-GL-2026`.

## Test And Release Gates

Fast checks:

```bash
npm run typecheck
npm run lint
npm run scripts:check
npm run motion:contract
npm audit --audit-level=moderate
```

Full Postgres browser gate:

```bash
npm run test:e2e
```

Local-store product smoke:

```bash
npm run test:e2e:local
```

Deployment readiness:

```bash
npm run deploy:readiness
```

Full release gate:

```bash
npm run release:gate
```

Production-ready means the browser flows pass in a clean profile. Build success alone is not sufficient.

## Deployment

Primary deployment target:

- Vercel
- Neon Postgres
- Resend
- server-side LLM proxy based on the `llm.ctox.dev` Responses API pattern
- STT provider such as Mistral Voxtral

Required deployment configuration is documented in:

- [docs/deployment-checklist.md](docs/deployment-checklist.md)
- [docs/postgres-neon-runbook.md](docs/postgres-neon-runbook.md)
- [docs/self-hosting.md](docs/self-hosting.md)

## Documentation

- [Product and parallel implementation plan](docs/learnbuddy-parallel-product-plan.md)
- [Platform architecture roadmap](docs/learnbuddy-platform-roadmap-architecture.md)
- [Motion design specification](docs/learnbuddy-motion-design-spec.md)
- [Deployment checklist](docs/deployment-checklist.md)
- [Self-hosting guide](docs/self-hosting.md)

## GitHub Pages Project Site

The static project page lives at:

```text
docs/index.html
```

When GitHub Pages is enabled for the repository with source `docs/`, this becomes the public project page.
