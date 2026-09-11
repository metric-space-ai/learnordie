import assert from "node:assert/strict";
import test from "node:test";
import {
  createAssistantMessageEventStream,
  type AssistantMessageEventStream,
  type Context,
  type Model
} from "@earendil-works/pi-ai";
import type { Api } from "@earendil-works/pi-ai";
import {
  createVercelPiCodingTextMessage,
  createVercelPiCodingToolCallMessage,
  createVercelPiCodingTools,
  runVercelPiCodingAgentTurn,
  vercelPiCodingToolNames,
  type VercelPiCodingToolName
} from "./pi-coding-agent-vercel";
import { createVercelVirtualExecutionEnv } from "./vercel-execution-env";

test("creates feature-complete Vercel Pi coding tool surface", () => {
  const env = createVercelVirtualExecutionEnv();
  const tools = createVercelPiCodingTools(env);

  assert.deepEqual(tools.map((tool) => tool.name).sort(), [...vercelPiCodingToolNames].sort());
});

test("upstream read/write/edit/bash/find/ls tools run over virtualfs operations", async () => {
  const env = createVercelVirtualExecutionEnv({
    files: {
      "src/main.ts": "const value = 'old';\nconsole.log(value);\n",
      "README.md": "# Demo\n"
    }
  });
  const tools = new Map(createVercelPiCodingTools(env).map((tool) => [tool.name, tool]));

  const read = await tools.get("read")?.execute("read-1", { path: "src/main.ts" } as never);
  assert.match(textFrom(read), /const value = 'old'/);

  const edit = await tools.get("edit")?.execute("edit-1", {
    path: "src/main.ts",
    edits: [{ oldText: "const value = 'old';", newText: "const value = 'new';" }]
  } as never);
  assert.match(textFrom(edit), /Successfully replaced 1 block/);
  assert.equal(unwrap(await env.readTextFile("src/main.ts")).includes("'new'"), true);

  const write = await tools.get("write")?.execute("write-1", {
    path: "src/generated.txt",
    content: "generated\n"
  } as never);
  assert.match(textFrom(write), /Successfully wrote/);
  assert.equal(unwrap(await env.readTextFile("src/generated.txt")), "generated\n");

  const bash = await tools.get("bash")?.execute("bash-1", {
    command: "cat src/generated.txt",
    timeout: 2
  } as never);
  assert.equal(textFrom(bash), "generated\n");

  const find = await tools.get("find")?.execute("find-1", {
    pattern: "**/*.ts",
    path: "."
  } as never);
  assert.equal(textFrom(find), "src/main.ts");

  const ls = await tools.get("ls")?.execute("ls-1", { path: "src" } as never);
  assert.equal(textFrom(ls), "generated.txt\nmain.ts");
});

test("ported grep tool searches virtualfs without host ripgrep", async () => {
  const env = createVercelVirtualExecutionEnv({
    files: {
      "src/main.ts": "alpha\nneedle one\n",
      "src/other.ts": "needle two\n",
      "node_modules/pkg/ignored.ts": "needle ignored\n"
    }
  });
  const grep = createVercelPiCodingTools(env).find((tool) => tool.name === "grep");

  const result = await grep?.execute("grep-1", {
    pattern: "needle",
    path: ".",
    glob: "**/*.ts",
    limit: 10
  } as never);

  assert.equal(textFrom(result), "src/main.ts:2: needle one\nsrc/other.ts:1: needle two");
});

test("ported grep tool falls back to literal search for invalid regex", async () => {
  const env = createVercelVirtualExecutionEnv({
    files: {
      "src/main.ts": "literal [ bracket\n"
    }
  });
  const grep = createVercelPiCodingTools(env).find((tool) => tool.name === "grep");

  const result = await grep?.execute("grep-invalid-regex-1", {
    pattern: "[",
    path: ".",
    glob: "**/*.ts"
  } as never);

  assert.equal(textFrom(result), "src/main.ts:1: literal [ bracket");
});

test("runVercelPiCodingAgentTurn executes model-requested upstream coding tools", async () => {
  const env = createVercelVirtualExecutionEnv({
    files: {
      "README.md": "# Original\n"
    }
  });
  const streamFn = (_model: Model<Api>, context: Context): AssistantMessageEventStream => {
    const stream = createAssistantMessageEventStream();
    const hasToolResult = context.messages.some((message) => message.role === "toolResult");
    stream.push({
      type: "done",
      reason: hasToolResult ? "stop" : "toolUse",
      message: hasToolResult
        ? createVercelPiCodingTextMessage("Done.")
        : createVercelPiCodingToolCallMessage("write", {
          path: "README.md",
          content: "# Updated\n"
        }, "write-readme")
    });
    return stream;
  };

  const result = await runVercelPiCodingAgentTurn({
    env,
    prompt: "Update README",
    streamFn,
    maxAssistantTurns: 4
  });

  assert.equal(unwrap(await env.readTextFile("README.md")), "# Updated\n");
  assert.equal(result.messages.some((message) => message.role === "toolResult" && message.toolName === "write"), true);
  assert.equal(result.messages.at(-1)?.role, "assistant");
  assert.deepEqual(result.snapshot.filter((entry) => entry.path === "/workspace/README.md"), [
    { path: "/workspace/README.md", kind: "file", content: "# Updated\n" }
  ]);
});

test("runVercelPiCodingAgentTurn honors an explicit empty tool list", async () => {
  const env = createVercelVirtualExecutionEnv();
  let toolCount = -1;
  const streamFn = (_model: Model<Api>, context: Context): AssistantMessageEventStream => {
    toolCount = context.tools?.length ?? 0;
    const stream = createAssistantMessageEventStream();
    stream.push({
      type: "done",
      reason: "stop",
      message: createVercelPiCodingTextMessage("No tools.")
    });
    return stream;
  };

  await runVercelPiCodingAgentTurn({
    env,
    prompt: "Answer without tools",
    streamFn,
    tools: []
  });

  assert.equal(toolCount, 0);
});

test("Vercel Pi coding bash tool never delegates unavailable commands to host", async () => {
  const env = createVercelVirtualExecutionEnv();
  const bash = createVercelPiCodingTools(env).find((tool) => tool.name === "bash");
  assert.ok(bash);

  await assert.rejects(
    () => bash.execute("bash-host-1", { command: "node -e console.log(1)", timeout: 2 } as never),
    /command not available in Vercel virtual shell/
  );
});

test("Vercel Pi coding bash tool caps output before upstream host temp persistence", async () => {
  const env = createVercelVirtualExecutionEnv({
    files: {
      "large-output.txt": `${"line\n".repeat(2_200)}${"x".repeat(60_000)}\n`
    }
  });
  const bash = createVercelPiCodingTools(env).find((tool) => tool.name === "bash");
  assert.ok(bash);

  const result = await bash.execute("bash-large-output-1", {
    command: "cat large-output.txt",
    timeout: 2
  } as never);

  assert.match(textFrom(result), /virtual shell stdout truncated/);
  assert.doesNotMatch(textFrom(result), /Full output:/);
  assert.equal((result.details as { fullOutputPath?: string } | undefined)?.fullOutputPath, undefined);
});

function textFrom(result: Awaited<ReturnType<NonNullable<ReturnType<typeof createVercelPiCodingTools>[number]>["execute"]>> | undefined): string {
  assert.ok(result);
  return result.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!result.ok) assert.fail(result.error.message);
  return result.value;
}

const _typecheckToolName: VercelPiCodingToolName = "read";
void _typecheckToolName;
