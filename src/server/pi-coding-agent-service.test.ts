import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizePiCodingAgentRequest,
  PiCodingAgentServiceError,
  runStatelessPiCodingAgent
} from "./pi-coding-agent-service";

test("authorizes stateless Pi coding-agent requests with configured bearer token", () => {
  withEnv({ LEARNORDIE_PI_CODING_AGENT_API_KEY: "service-token" }, () => {
    const request = new Request("https://learnordie.test/api/pi-coding-agent/run", {
      method: "POST",
      headers: { authorization: "Bearer service-token" }
    });

    assert.deepEqual(authorizePiCodingAgentRequest(request), { ok: true });
  });
});

test("rejects workspace paths that escape /workspace", async () => {
  await withEnvAsync(serviceEnv(), async () => {
    await assert.rejects(
      () => runStatelessPiCodingAgent({
        prompt: "Try to write outside the workspace",
        files: {
          "../secret.txt": "nope\n"
        }
      }),
      (error) => error instanceof PiCodingAgentServiceError && error.status === 400
    );
  });
});

test("runs a disposable Pi coding-agent session through the Responses proxy adapter", async () => {
  await withEnvAsync(serviceEnv(), async () => {
    const fetchCalls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      fetchCalls.push({ url: String(url), body });
      if (fetchCalls.length === 1) {
        return Response.json({
          output: [
            {
              type: "function_call",
              call_id: "write-readme",
              name: "write",
              arguments: JSON.stringify({
                path: "README.md",
                content: "# New\n"
              })
            }
          ],
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }
        });
      }

      return Response.json({
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Updated README." }]
          }
        ],
        usage: { input_tokens: 7, output_tokens: 3, total_tokens: 10 }
      });
    };

    try {
      const result = await runStatelessPiCodingAgent({
        prompt: "Update README",
        files: {
          "README.md": "# Old\n"
        },
        tools: ["read", "write"],
        maxAssistantTurns: 4
      });

      assert.equal(result.status, "completed");
      assert.equal(result.provider, "learnordie-responses");
      assert.equal(result.model, "MiniMax-M3");
      assert.equal(result.snapshot.find((entry) => entry.path === "/workspace/README.md")?.content, "# New\n");
      assert.match(result.diff, /-# Old/);
      assert.match(result.diff, /\+# New/);
      assert.equal(fetchCalls.length, 2);
      assert.equal(fetchCalls[0]?.url, "https://proxy.test/v1/responses");
      assert.deepEqual((fetchCalls[0]?.body.tools as Array<{ name: string }>).map((tool) => tool.name).sort(), ["read", "write"]);
      assert.equal(JSON.stringify(fetchCalls[1]?.body.input).includes("function_call_output"), true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

test("applies read-only mode to the Pi coding-agent tool surface", async () => {
  await withEnvAsync(serviceEnv(), async () => {
    const fetchCalls: Array<{ body: Record<string, unknown> }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_url, init) => {
      fetchCalls.push({ body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
      return Response.json({
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "Read-only inspection complete." }]
          }
        ],
        usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 }
      });
    };

    try {
      const result = await runStatelessPiCodingAgent({
        prompt: "Inspect files",
        files: { "README.md": "# Existing\n" },
        mode: "readOnly"
      });

      assert.deepEqual(result.tools, ["read", "grep", "find", "ls"]);
      assert.deepEqual((fetchCalls[0]?.body.tools as Array<{ name: string }>).map((tool) => tool.name), ["read", "grep", "find", "ls"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

function serviceEnv() {
  return {
    LEARNBUDDY_AI_PROVIDER: "learnordie-responses",
    LEARNORDIE_LLM_PROXY_BASE_URL: "https://proxy.test",
    LEARNORDIE_LLM_PROXY_API_KEY: "proxy-token",
    LEARNORDIE_PI_CODING_AGENT_API_KEY: "service-token"
  };
}

function withEnv<T>(env: Record<string, string>, callback: () => T): T {
  const previous = new Map<string, string | undefined>();
  for (const key of Object.keys(env)) previous.set(key, process.env[key]);
  Object.assign(process.env, env);
  try {
    return callback();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function withEnvAsync<T>(env: Record<string, string>, callback: () => Promise<T>): Promise<T> {
  return withEnv(env, callback);
}
