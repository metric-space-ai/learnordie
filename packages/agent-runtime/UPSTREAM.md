# Pi Runtime Upstream Pin

Learnordie uses Pi as a maintenance reference for the agent loop shape, not as a visible UI or as a generic coding agent.

- Upstream: `https://github.com/earendil-works/pi`
- Learnordie fork target: `metric-space-ai/pi-learnordie`
- Audited upstream tag: `v0.80.2`
- Audited upstream commit: `0201806adfa825ab3d7957a4267d46e5030fd357`

Included concepts:

- Threaded agent runs
- Streaming event vocabulary
- Tool execution accounting
- Reviewable artifacts before commit

Explicitly excluded from Learnordie v1:

- `pi-coding-agent`
- `pi-tui`
- Shell, process, filesystem, edit/write, and generic network tools
- Direct database mutations from the agent loop
- Provider SDK fan-out outside Learnordie's `AIProvider`

All productive actions are Learnordie-owned tools with server-side authorization, CSRF checks, validation, review diffs, and explicit lecturer acceptance.
