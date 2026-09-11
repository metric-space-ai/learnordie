# `@learnordie/agent-runtime`

Learnordie's Vercel-safe port of the pinned Pi core and coding-agent runtime.

This package uses the real Pi core packages:

- `@earendil-works/pi-agent-core@0.80.2`
- `@earendil-works/pi-ai@0.80.2`
- `@earendil-works/pi-coding-agent@0.80.2`

The port adapts Pi's agent loop, message events, tool execution contract, and
coding-agent tool surface to Learnordie's serverless backend. It is not a
from-scratch lookalike runtime. The CLI/TUI product shell is still excluded, but
the coding-agent workbench is ported through Vercel-safe operations.

The package deliberately exposes only Learnordie-owned product primitives:

- allowlisted tool definitions
- a Pi-compatible virtual `ExecutionEnv` for Vercel-safe filesystem/shell work
- Vercel Pi coding-agent tools: `read`, `bash`, `edit`, `write`, `grep`,
  `find`, and `ls`
- server-side run events
- review patches for `SlideDocumentEditOperation[]`
- deterministic slide-edit fallback when no LLM provider is available

It does not expose host shell, host filesystem, process, generic network, or TUI
capabilities. The `bash` tool runs on the virtual filesystem and allowlisted
virtual shell only.

See `UPSTREAM.md` for the upstream pin and `PORTING.md` for the porting contract.
