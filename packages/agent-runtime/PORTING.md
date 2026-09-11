# Pi Core Vercel Port Contract

This package is the Learnordie port of Pi core and Pi coding-agent for the
Vercel/Next.js backend. It must stay mechanically traceable to Pi `v0.80.2`
(`0201806adfa825ab3d7957a4267d46e5030fd357`).

## Upstream Mapping

- `@earendil-works/pi-agent-core@0.80.2`
  - Used for the real agent loop and tool execution lifecycle.
  - Learnordie calls `runAgentLoop` through `src/pi-vercel-adapter.ts`.
- `@earendil-works/pi-ai@0.80.2`
  - Used for Pi message, model, tool, usage, and event-stream protocol types.
  - Learnordie's existing `AIProvider` is adapted into a Pi-compatible stream.
- `@earendil-works/pi-coding-agent@0.80.2`
  - Used for the real Pi coding-agent tool factories and shared tool helpers.
  - Learnordie calls those factories through `src/pi-coding-agent-vercel.ts`
    with virtual filesystem and shell operations.
- `packages/agent-runtime/src/index.ts`
  - Owns Learnordie-specific tools, patch review artifacts, and accept/reject
    boundaries.

## Vercel Boundaries

The port must be safe for serverless request execution:

- no `pi-tui`
- no host shell/process execution
- no host filesystem mutation from inside the agent loop
- no generic network tools exposed to the model
- no direct database mutation from the Pi loop

The current virtual filesystem/shell port targets the Vercel Node.js serverless
runtime, not the Vercel Edge runtime. `virtualfs` itself supplies browser builds,
but Learnordie's runtime package still uses Node-compatible server packaging
through `next.config.ts`.

Persistence stays in the app repository layer. Productive changes are review
patches only until a lecturer explicitly accepts them through the app server.

## Coding Agent Tool Surface

The Vercel port exposes a Pi coding-agent workbench over the virtual
`ExecutionEnv`:

- `read`
- `bash`
- `edit`
- `write`
- `grep`
- `find`
- `ls`

`read`, `bash`, `edit`, `write`, `find`, and `ls` are instantiated from the
real upstream `@earendil-works/pi-coding-agent` factories with Learnordie
operations injected. `grep` keeps the upstream tool name, parameter schema, and
output contract, but is implemented locally because the upstream grep tool still
spawns `rg` through `child_process`; Vercel must search the virtual filesystem
without delegating to host processes.

The exported `runVercelPiCodingAgentTurn` function runs those tools through
Pi's `runAgentLoop` and returns Pi messages, Pi events, and the updated virtual
workspace snapshot. It is a coding-agent turn/session primitive, not a terminal
UI.

## Stateless Backend Service

The app exposes the Vercel port as a disposable headless service at
`POST /api/pi-coding-agent/run`.

Each request creates a fresh RAM workspace from the submitted file snapshot,
runs `runVercelPiCodingAgentTurn`, calls the Learnordie OpenAI-compatible
Responses proxy with Pi function tools, and returns Pi messages, Pi events, the
final virtual snapshot, and a capped whole-file diff. No session state is
persisted by this endpoint and no host filesystem or host shell is exposed.

The endpoint is bound to the Learnordie Responses proxy. It is protected by
Bearer auth (`LEARNORDIE_PI_CODING_AGENT_API_KEY`, with the LLM proxy token
accepted as a fallback for internal deployments) and request limits for body
size, file count, file bytes, turn count, snapshot size, and diff size. Tool
access can be provided explicitly or selected with the `coding`, `readOnly`, or
`all` modes.

## Virtual Filesystem And Shell Direction

Vercel-compatible filesystem and shell support must be implemented as a Pi
`ExecutionEnv`, not as access to the deployment host.

- Filesystem: use a per-thread virtual POSIX-like filesystem snapshot. The
  current implementation is `src/vercel-execution-env.ts`, backed by
  `MatrixAI/js-virtualfs` (`virtualfs@2.2.0`), an in-memory Node/browser
  filesystem replacement.
- Shell: use an allowlisted command interpreter over that virtual filesystem.
  `thomasloupe/SimulaCLI` is useful as a reference for browser-side command
  semantics, pipes, redirects, and common built-ins, but should not be treated
  as a trusted server shell.
- Persistence: store snapshots/diffs as Learnordie agent artifacts or repository
  records. Do not rely on Vercel instance-local disk for durable state.
- Productive writes: expose virtual writes as review artifacts first. Applying
  them to lectures or persisted materials still requires app-server validation
  and explicit lecturer acceptance.

The first allowed shell surface is deliberately small: `pwd`, `echo`, `ls`,
`cat`, `head`, `tail`, `wc`, `grep`, `cp`, `mv`, `rm`, `mkdir`, `touch`,
`diff`, and `printenv`, plus simple pipes and output redirection. Network
commands, package managers, user switching, chmod/chown, process control, and
arbitrary JavaScript execution stay excluded until they have a separate security
design.

Virtual shell output is capped below Pi's upstream bash-output truncation
thresholds before it reaches the upstream `createBashTool` accumulator. That
prevents the upstream tool from persisting oversized output to a host temp file
while preserving the normal Pi bash-tool return shape.

The virtual shell rejects command chaining (`&&`, `||`, `;`) and input
redirection (`<`) with a usage-style exit code. Unknown commands return exit
code `127` and are never delegated to a host shell.

## Provider Boundary

Pi's provider fan-out is not exposed directly. Learnordie keeps provider
selection in `src/server/providers/ai.ts` and adapts that provider into the Pi
stream contract. This preserves the deployed `learnordie-responses`/MiniMax-M3
proxy path while still running the actual Pi core loop.
