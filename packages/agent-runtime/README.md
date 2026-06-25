# `@learnordie/agent-runtime`

Small Learnordie runtime adapter inspired by `earendil-works/pi` and pinned in `UPSTREAM.md`.

The package deliberately exposes only Learnordie-owned primitives:

- allowlisted tool definitions
- server-side run events
- review patches for `SlideDocumentEditOperation[]`
- deterministic slide-edit fallback when no LLM provider is available

It does not expose shell, filesystem, process, network, coding-agent, or TUI capabilities.
