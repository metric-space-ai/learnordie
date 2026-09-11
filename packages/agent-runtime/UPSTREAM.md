# Pi Runtime Upstream Pin

Learnordie uses Pi core as a real Vercel-platform port, not merely as visual
inspiration. The runtime depends on the pinned Pi core packages and adapts them
to Learnordie's server-side authorization, persistence, and review-patch model.

This is still not a full Pi product port: the Pi CLI and TUI remain out of
scope for Learnordie. The coding-agent core tool surface is ported for the
Vercel Node.js serverless runtime.

- Upstream: `https://github.com/earendil-works/pi`
- Learnordie fork target: `metric-space-ai/pi-learnordie`
- Audited upstream tag: `v0.80.2`
- Audited upstream commit: `0201806adfa825ab3d7957a4267d46e5030fd357`
- Runtime dependency: `@earendil-works/pi-agent-core@0.80.2`
- AI protocol dependency: `@earendil-works/pi-ai@0.80.2`
- Coding-agent dependency: `@earendil-works/pi-coding-agent@0.80.2`

Ported core surface:

- Threaded agent runs
- Streaming event vocabulary
- Tool execution accounting
- Reviewable artifacts before commit
- Agent loop/tool execution through `@earendil-works/pi-agent-core`
- Pi AI message and stream protocol through `@earendil-works/pi-ai`
- Vercel-safe Pi `ExecutionEnv` backed by `virtualfs@2.2.0`
- Coding-agent tools through `src/pi-coding-agent-vercel.ts`:
  `read`, `bash`, `edit`, `write`, `grep`, `find`, and `ls`
- Coding-agent turn API through `runVercelPiCodingAgentTurn`

Explicitly excluded from Learnordie v1:

- `pi-tui`
- Host shell/process/filesystem access and generic network tools
- Direct database mutations from the agent loop
- Provider SDK fan-out outside Learnordie's `AIProvider`

All productive actions are Learnordie-owned tools with server-side authorization, CSRF checks, validation, review diffs, and explicit lecturer acceptance.
