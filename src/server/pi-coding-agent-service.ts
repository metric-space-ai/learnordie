import { posix as path } from "node:path";
import {
  createVercelVirtualExecutionEnv,
  runVercelPiCodingAgentTurn,
  vercelPiCodingToolNames,
  type RunVercelPiCodingAgentTurnInput,
  type VercelPiCodingToolName,
  type VercelPiCodingToolsMode,
  type VirtualFileSnapshotEntry
} from "@learnordie/agent-runtime";
import { z } from "zod";
import {
  configuredLearnordieProxyClientTokens,
  LEARNORDIE_RESPONSES_MODEL,
  LEARNORDIE_RESPONSES_PROVIDER,
  LEARNORDIE_RESPONSES_PROXY_BASE_URL
} from "./llm-proxy";

type JsonObject = Record<string, unknown>;
type PiContext = Parameters<RunVercelPiCodingAgentTurnInput["streamFn"]>[1];
type PiModel = Parameters<RunVercelPiCodingAgentTurnInput["streamFn"]>[0];

type AssistantMessageShape = {
  role: "assistant";
  content: Array<
    | { type: "text"; text: string }
    | { type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }
  >;
  api: string;
  provider: string;
  model: string;
  usage: PiUsage;
  stopReason: "stop" | "toolUse" | "error";
  errorMessage?: string;
  timestamp: number;
};

type PiUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
};

type StatelessPiCodingAgentInput = {
  prompt: string;
  cwd?: string;
  files?: Record<string, string>;
  tools?: VercelPiCodingToolName[];
  mode?: VercelPiCodingToolsMode;
  maxAssistantTurns?: number;
  systemPrompt?: string;
  shellEnv?: Record<string, string>;
};

export type StatelessPiCodingAgentRunResult = {
  status: "completed";
  provider: string;
  model: string;
  cwd: string;
  tools: VercelPiCodingToolName[];
  messages: unknown[];
  events: unknown[];
  snapshot: VirtualFileSnapshotEntry[];
  diff: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  limits: {
    maxAssistantTurns: number;
    maxFiles: number;
    maxFileBytes: number;
    maxTotalFileBytes: number;
    maxSnapshotBytes: number;
    maxDiffBytes: number;
  };
  truncated: {
    snapshot: boolean;
    diff: boolean;
  };
  durationMs: number;
};

export class PiCodingAgentServiceError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const DEFAULT_CWD = "/workspace";
const DEFAULT_MAX_BODY_BYTES = 256 * 1024;
const DEFAULT_MAX_FILES = 64;
const DEFAULT_MAX_FILE_BYTES = 64 * 1024;
const DEFAULT_MAX_TOTAL_FILE_BYTES = 192 * 1024;
const DEFAULT_MAX_PROMPT_CHARS = 12_000;
const DEFAULT_MAX_SYSTEM_PROMPT_CHARS = 8_000;
const DEFAULT_MAX_SHELL_ENV_VARS = 24;
const DEFAULT_MAX_SHELL_ENV_VALUE_CHARS = 1_000;
const DEFAULT_MAX_ASSISTANT_TURNS = 8;
const DEFAULT_HARD_MAX_ASSISTANT_TURNS = 12;
const DEFAULT_MAX_SNAPSHOT_BYTES = 256 * 1024;
const DEFAULT_MAX_DIFF_BYTES = 128 * 1024;
const DEFAULT_PROVIDER_TIMEOUT_MS = 60_000;
const DEFAULT_SERVICE_TIMEOUT_MS = 85_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 1_200;

const toolNameSchema = z.enum(vercelPiCodingToolNames);
const requestSchema = z.object({
  prompt: z.string().trim().min(1),
  cwd: z.string().trim().min(1).optional(),
  files: z.record(z.string(), z.string()).optional(),
  tools: z.array(toolNameSchema).optional(),
  mode: z.enum(["coding", "readOnly", "all"]).optional(),
  maxAssistantTurns: z.number().int().positive().optional(),
  systemPrompt: z.string().optional(),
  shellEnv: z.record(z.string(), z.string()).optional()
}).strict();

export function piCodingAgentMaxBodyBytes(): number {
  return envInt("LEARNORDIE_PI_CODING_AGENT_MAX_BODY_BYTES", envInt("LEARNBUDDY_PI_CODING_AGENT_MAX_BODY_BYTES", DEFAULT_MAX_BODY_BYTES));
}

export function configuredPiCodingAgentTokens(): string[] {
  return uniqueStrings([
    process.env.LEARNORDIE_PI_CODING_AGENT_API_KEY,
    process.env.LEARNBUDDY_PI_CODING_AGENT_API_KEY,
    ...configuredLearnordieProxyClientTokens()
  ]);
}

export function authorizePiCodingAgentRequest(request: Request):
  | { ok: true }
  | { ok: false; status: 403 | 503; body: { error: string } } {
  const tokens = configuredPiCodingAgentTokens();
  if (tokens.length === 0) {
    return { ok: false, status: 503, body: { error: "Pi coding-agent service is not configured." } };
  }

  const auth = request.headers.get("authorization") || "";
  const token = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  if (!token || !tokens.includes(token)) {
    return { ok: false, status: 403, body: { error: "Pi coding-agent service access denied." } };
  }

  return { ok: true };
}

export async function runStatelessPiCodingAgent(rawInput: unknown): Promise<StatelessPiCodingAgentRunResult> {
  const input = normalizeRequest(rawInput);
  const startedAt = Date.now();
  const provider = configuredPiCodingAgentProviderInfo();
  const streamFn = createLearnordieResponsesPiStreamFn({
    provider: provider.provider,
    model: provider.model,
    endpoint: learnordieResponsesEndpoint(),
    apiKey: learnordieResponsesClientToken(),
    timeoutMs: providerTimeoutMs(),
    maxOutputTokens: maxOutputTokens()
  });

  const env = createVercelVirtualExecutionEnv({
    cwd: input.cwd,
    files: input.files,
    shellEnv: input.shellEnv
  });
  const initialSnapshot = checkedSnapshot(env.snapshotTextFiles(input.cwd));
  const selectedTools = input.tools ?? toolsForMode(input.mode);
  const hardMaxTurns = envInt("LEARNORDIE_PI_CODING_AGENT_HARD_MAX_ASSISTANT_TURNS", DEFAULT_HARD_MAX_ASSISTANT_TURNS);
  const configuredMaxAssistantTurns = envInt("LEARNORDIE_PI_CODING_AGENT_MAX_ASSISTANT_TURNS", DEFAULT_MAX_ASSISTANT_TURNS);
  const maxAssistantTurns = Math.min(input.maxAssistantTurns ?? configuredMaxAssistantTurns, hardMaxTurns);

  const result = await withTimeout(
    runVercelPiCodingAgentTurn({
      env,
      prompt: input.prompt,
      streamFn,
      systemPrompt: input.systemPrompt,
      tools: selectedTools,
      maxAssistantTurns
    }),
    serviceTimeoutMs()
  );

  const snapshotResult = capSnapshot(result.snapshot, maxSnapshotBytes());
  const diffResult = createSnapshotDiff(initialSnapshot, result.snapshot, input.cwd, maxDiffBytes());
  const usage = summarizeUsage(result.messages);

  return {
    status: "completed",
    provider: provider.provider,
    model: provider.model,
    cwd: input.cwd,
    tools: selectedTools,
    messages: result.messages,
    events: result.events,
    snapshot: snapshotResult.snapshot,
    diff: diffResult.diff,
    usage,
    limits: {
      maxAssistantTurns,
      maxFiles: maxFiles(),
      maxFileBytes: maxFileBytes(),
      maxTotalFileBytes: maxTotalFileBytes(),
      maxSnapshotBytes: maxSnapshotBytes(),
      maxDiffBytes: maxDiffBytes()
    },
    truncated: {
      snapshot: snapshotResult.truncated,
      diff: diffResult.truncated
    },
    durationMs: Date.now() - startedAt
  };
}

function normalizeRequest(rawInput: unknown): Required<Pick<StatelessPiCodingAgentInput, "prompt" | "cwd" | "files" | "mode" | "shellEnv">>
  & Pick<StatelessPiCodingAgentInput, "tools" | "maxAssistantTurns" | "systemPrompt"> {
  const parsed = requestSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new PiCodingAgentServiceError(400, "Invalid Pi coding-agent request.");
  }

  const data = parsed.data;
  if (data.prompt.length > maxPromptChars()) {
    throw new PiCodingAgentServiceError(413, "Pi coding-agent prompt is too large.");
  }
  if (data.systemPrompt && data.systemPrompt.length > DEFAULT_MAX_SYSTEM_PROMPT_CHARS) {
    throw new PiCodingAgentServiceError(413, "Pi coding-agent system prompt is too large.");
  }
  if (data.tools && data.mode) {
    throw new PiCodingAgentServiceError(400, "Use either tools or mode, not both.");
  }

  const cwd = normalizeWorkspacePath(data.cwd ?? DEFAULT_CWD);
  const files = normalizeFiles(cwd, data.files ?? {});
  const shellEnv = normalizeShellEnv(data.shellEnv ?? {});
  const tools = data.tools ? uniqueTools(data.tools) : undefined;
  const hardMaxTurns = envInt("LEARNORDIE_PI_CODING_AGENT_HARD_MAX_ASSISTANT_TURNS", DEFAULT_HARD_MAX_ASSISTANT_TURNS);
  const maxAssistantTurns = data.maxAssistantTurns === undefined
    ? undefined
    : Math.min(data.maxAssistantTurns, hardMaxTurns);

  return {
    prompt: data.prompt,
    cwd,
    files,
    tools,
    mode: data.mode ?? "all",
    maxAssistantTurns,
    systemPrompt: data.systemPrompt,
    shellEnv
  };
}

function createLearnordieResponsesPiStreamFn(input: {
  endpoint: string;
  apiKey: string;
  provider: string;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
}): RunVercelPiCodingAgentTurnInput["streamFn"] {
  return (_model: PiModel, context: PiContext) => {
    const stream = new LocalAssistantMessageEventStream();
    void (async () => {
      try {
        const response = await callResponsesToolModel(input, context);
        const message = parseResponsesAssistantMessage(response, input);
        stream.push({
          type: "done",
          reason: message.stopReason === "toolUse" ? "toolUse" : "stop",
          message
        });
      } catch (error) {
        stream.push({
          type: "error",
          reason: "error",
          error: createErrorAssistantMessage(error, input)
        });
      }
    })();
    return stream as unknown as ReturnType<RunVercelPiCodingAgentTurnInput["streamFn"]>;
  };
}

async function callResponsesToolModel(input: {
  endpoint: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxOutputTokens: number;
}, context: PiContext): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const tools = (context.tools ?? []).map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }));
    const response = await fetch(input.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${input.apiKey}`
      },
      body: JSON.stringify({
        model: input.model,
        input: responsesInputFromPiContext(context),
        tools: tools.length > 0 ? tools : undefined,
        tool_choice: tools.length > 0 ? "auto" : "none",
        max_output_tokens: input.maxOutputTokens,
        reasoning: { effort: "none" },
        store: false
      }),
      signal: controller.signal
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = errorMessageFromPayload(payload) ?? `HTTP ${response.status}`;
      throw new Error(`Responses tool-call request failed: ${message}`);
    }
    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Responses tool-call request timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function responsesInputFromPiContext(context: PiContext): unknown[] {
  const input: unknown[] = [];
  if (context.systemPrompt) {
    input.push({
      type: "message",
      role: "system",
      content: [{ type: "input_text", text: context.systemPrompt }]
    });
  }

  for (const message of context.messages) {
    if (message.role === "user") {
      input.push({
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: piContentToText(message.content) }]
      });
      continue;
    }

    if (message.role === "assistant") {
      const text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("");
      if (text) {
        input.push({
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text }]
        });
      }
      for (const part of message.content) {
        if (part.type !== "toolCall") continue;
        input.push({
          type: "function_call",
          call_id: part.id,
          name: part.name,
          arguments: JSON.stringify(part.arguments ?? {})
        });
      }
      continue;
    }

    if (message.role === "toolResult") {
      input.push({
        type: "function_call_output",
        call_id: message.toolCallId,
        output: message.content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")
      });
    }
  }
  return input;
}

function parseResponsesAssistantMessage(payload: unknown, input: { provider: string; model: string }): AssistantMessageShape {
  const toolCalls = extractResponsesToolCalls(payload);
  if (toolCalls.length > 0) {
    return {
      role: "assistant",
      content: toolCalls,
      api: "learnordie-responses",
      provider: input.provider,
      model: input.model,
      usage: usageFromPayload(payload),
      stopReason: "toolUse",
      timestamp: Date.now()
    };
  }

  return {
    role: "assistant",
    content: [{ type: "text", text: extractResponsesText(payload) || "Done." }],
    api: "learnordie-responses",
    provider: input.provider,
    model: input.model,
    usage: usageFromPayload(payload),
    stopReason: "stop",
    timestamp: Date.now()
  };
}

function extractResponsesToolCalls(payload: unknown): Array<{ type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }> {
  const output = isRecord(payload) && Array.isArray(payload.output) ? payload.output : [];
  const calls: Array<{ type: "toolCall"; id: string; name: string; arguments: Record<string, unknown> }> = [];
  for (const item of output) {
    if (!isRecord(item) || item.type !== "function_call") continue;
    const name = typeof item.name === "string" ? item.name : "";
    if (!isVercelPiCodingToolName(name)) continue;
    const id = typeof item.call_id === "string"
      ? item.call_id
      : typeof item.id === "string" ? item.id : `call_${calls.length + 1}`;
    calls.push({
      type: "toolCall",
      id,
      name,
      arguments: parseToolArguments(item.arguments)
    });
  }
  return calls;
}

function extractResponsesText(payload: unknown): string {
  if (!isRecord(payload)) return "";
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  const output = Array.isArray(payload.output) ? payload.output : [];
  const parts: string[] = [];
  for (const item of output) {
    if (!isRecord(item)) continue;
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const content of item.content) {
        if (!isRecord(content)) continue;
        if (typeof content.text === "string") parts.push(content.text);
      }
    }
  }
  return parts.join("").trim();
}

function parseToolArguments(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value !== "string" || !value.trim()) return {};
  const parsed = JSON.parse(value) as unknown;
  if (!isRecord(parsed)) throw new Error("Tool arguments must be a JSON object.");
  return parsed;
}

function createErrorAssistantMessage(error: unknown, input: { provider: string; model: string }): AssistantMessageShape {
  const message = error instanceof Error ? error.message : "Unknown Pi coding-agent provider error.";
  return {
    role: "assistant",
    content: [{ type: "text", text: message }],
    api: "learnordie-responses",
    provider: input.provider,
    model: input.model,
    usage: emptyUsage(),
    stopReason: "error",
    errorMessage: message,
    timestamp: Date.now()
  };
}

function normalizeFiles(cwd: string, files: Record<string, string>): Record<string, string> {
  const entries = Object.entries(files);
  if (entries.length > maxFiles()) {
    throw new PiCodingAgentServiceError(413, "Pi coding-agent request has too many files.");
  }

  const normalized: Record<string, string> = {};
  let totalBytes = 0;
  for (const [filePath, content] of entries) {
    const normalizedPath = normalizeWorkspacePath(path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath));
    if (normalizedPath === DEFAULT_CWD) {
      throw new PiCodingAgentServiceError(400, "Pi coding-agent file path must point to a file under /workspace.");
    }
    const bytes = byteLength(content);
    if (bytes > maxFileBytes()) {
      throw new PiCodingAgentServiceError(413, `Pi coding-agent file is too large: ${filePath}`);
    }
    totalBytes += bytes;
    if (totalBytes > maxTotalFileBytes()) {
      throw new PiCodingAgentServiceError(413, "Pi coding-agent request files are too large.");
    }
    normalized[normalizedPath] = content;
  }
  return normalized;
}

function normalizeShellEnv(shellEnv: Record<string, string>): Record<string, string> {
  const entries = Object.entries(shellEnv);
  if (entries.length > DEFAULT_MAX_SHELL_ENV_VARS) {
    throw new PiCodingAgentServiceError(413, "Pi coding-agent shell environment has too many variables.");
  }

  const normalized: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      throw new PiCodingAgentServiceError(400, `Invalid shell environment variable name: ${name}`);
    }
    if (value.length > DEFAULT_MAX_SHELL_ENV_VALUE_CHARS) {
      throw new PiCodingAgentServiceError(413, `Shell environment variable is too large: ${name}`);
    }
    normalized[name] = value;
  }
  return normalized;
}

function normalizeWorkspacePath(filePath: string): string {
  if (filePath.includes("\0")) throw new PiCodingAgentServiceError(400, "Pi coding-agent paths must not contain NUL bytes.");
  const normalized = path.normalize(filePath || DEFAULT_CWD);
  const absolute = normalized.startsWith("/") ? normalized : path.join(DEFAULT_CWD, normalized);
  if (absolute !== DEFAULT_CWD && !absolute.startsWith(`${DEFAULT_CWD}/`)) {
    throw new PiCodingAgentServiceError(400, "Pi coding-agent paths must stay under /workspace.");
  }
  return absolute;
}

function toolsForMode(mode: VercelPiCodingToolsMode): VercelPiCodingToolName[] {
  if (mode === "coding") return ["read", "bash", "edit", "write"];
  if (mode === "readOnly") return ["read", "grep", "find", "ls"];
  return [...vercelPiCodingToolNames];
}

function uniqueTools(tools: VercelPiCodingToolName[]): VercelPiCodingToolName[] {
  return [...new Set(tools)];
}

function checkedSnapshot(result: ReturnType<ReturnType<typeof createVercelVirtualExecutionEnv>["snapshotTextFiles"]>): VirtualFileSnapshotEntry[] {
  if (!result.ok) throw new PiCodingAgentServiceError(500, result.error.message);
  return result.value;
}

function createSnapshotDiff(
  initialSnapshot: VirtualFileSnapshotEntry[],
  finalSnapshot: VirtualFileSnapshotEntry[],
  cwd: string,
  maxBytes: number
): { diff: string; truncated: boolean } {
  const before = snapshotMap(initialSnapshot);
  const after = snapshotMap(finalSnapshot);
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort((left, right) => left.localeCompare(right));
  let diff = "";
  let truncated = false;

  for (const filePath of paths) {
    const oldContent = before.get(filePath);
    const newContent = after.get(filePath);
    if (oldContent === newContent) continue;
    const patch = createWholeFilePatch(displayPath(cwd, filePath), oldContent, newContent);
    if (byteLength(diff) + byteLength(patch) > maxBytes) {
      truncated = true;
      break;
    }
    diff += patch;
  }

  if (truncated) diff += "\n[pi-coding-agent diff truncated]\n";
  return { diff, truncated };
}

function snapshotMap(snapshot: VirtualFileSnapshotEntry[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const entry of snapshot) {
    if (entry.kind === "file") result.set(entry.path, entry.content ?? "");
  }
  return result;
}

function createWholeFilePatch(relativePath: string, oldContent: string | undefined, newContent: string | undefined): string {
  const oldLabel = oldContent === undefined ? "/dev/null" : `a/${relativePath}`;
  const newLabel = newContent === undefined ? "/dev/null" : `b/${relativePath}`;
  const oldLines = splitPatchLines(oldContent ?? "");
  const newLines = splitPatchLines(newContent ?? "");
  return [
    `diff --git a/${relativePath} b/${relativePath}`,
    `--- ${oldLabel}`,
    `+++ ${newLabel}`,
    "@@",
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`),
    ""
  ].join("\n");
}

function capSnapshot(snapshot: VirtualFileSnapshotEntry[], maxBytes: number): { snapshot: VirtualFileSnapshotEntry[]; truncated: boolean } {
  const capped: VirtualFileSnapshotEntry[] = [];
  let totalBytes = 0;
  let truncated = false;
  for (const entry of snapshot) {
    const entryBytes = byteLength(entry.content ?? "");
    if (entry.kind === "file" && totalBytes + entryBytes > maxBytes) {
      truncated = true;
      continue;
    }
    capped.push(entry);
    totalBytes += entryBytes;
  }
  return { snapshot: capped, truncated };
}

function summarizeUsage(messages: unknown[]): StatelessPiCodingAgentRunResult["usage"] {
  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  for (const message of messages) {
    if (!isRecord(message) || !isRecord(message.usage)) continue;
    inputTokens += numberValue(message.usage.input) + numberValue(message.usage.inputTokens);
    outputTokens += numberValue(message.usage.output) + numberValue(message.usage.outputTokens);
    totalTokens += numberValue(message.usage.totalTokens) + numberValue(message.usage.total_tokens);
  }
  if (totalTokens === 0) totalTokens = inputTokens + outputTokens;
  return { inputTokens, outputTokens, totalTokens };
}

function usageFromPayload(payload: unknown): PiUsage {
  if (!isRecord(payload) || !isRecord(payload.usage)) return emptyUsage();
  const input = numberValue(payload.usage.input_tokens) + numberValue(payload.usage.prompt_tokens) + numberValue(payload.usage.input);
  const output = numberValue(payload.usage.output_tokens) + numberValue(payload.usage.completion_tokens) + numberValue(payload.usage.output);
  const totalTokens = numberValue(payload.usage.total_tokens) + numberValue(payload.usage.totalTokens) || input + output;
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  };
}

function emptyUsage(): PiUsage {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  };
}

class LocalAssistantMessageEventStream implements AsyncIterable<unknown> {
  private readonly queue: unknown[] = [];
  private readonly waiters: Array<(value: IteratorResult<unknown>) => void> = [];
  private readonly resultPromise: Promise<unknown>;
  private resolveResult!: (value: unknown) => void;
  private done = false;

  constructor() {
    this.resultPromise = new Promise((resolve) => {
      this.resolveResult = resolve;
    });
  }

  push(event: unknown): void {
    if (this.done) return;
    if (isRecord(event) && (event.type === "done" || event.type === "error")) {
      this.done = true;
      this.resolveResult(event.type === "done" ? event.message : event.error);
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter({ value: event, done: false });
    } else {
      this.queue.push(event);
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<unknown> {
    while (true) {
      const event = this.queue.shift();
      if (event) {
        yield event;
        continue;
      }
      if (this.done) return;
      const result = await new Promise<IteratorResult<unknown>>((resolve) => {
        this.waiters.push(resolve);
      });
      if (result.done) return;
      yield result.value;
    }
  }

  result(): Promise<unknown> {
    return this.resultPromise;
  }
}

function learnordieResponsesEndpoint(): string {
  const raw = process.env.LEARNORDIE_LLM_PROXY_BASE_URL
    ?? process.env.LEARNBUDDY_LLM_PROXY_BASE_URL
    ?? process.env.CTOX_LLM_PROXY_BASE_URL
    ?? process.env.LEARNBUDDY_AI_BASE_URL
    ?? LEARNORDIE_RESPONSES_PROXY_BASE_URL;
  const trimmed = raw.trim().replace(/\/+$/, "");
  return trimmed.endsWith("/responses") ? trimmed : `${trimmed}/v1/responses`;
}

function configuredPiCodingAgentProviderInfo(): { provider: string; model: string } {
  return {
    provider: LEARNORDIE_RESPONSES_PROVIDER,
    model: process.env.LEARNORDIE_PI_CODING_AGENT_MODEL?.trim()
      || process.env.LEARNBUDDY_AI_MODEL?.trim()
      || LEARNORDIE_RESPONSES_MODEL
  };
}

function learnordieResponsesClientToken(): string {
  const token = configuredLearnordieProxyClientTokens()[0];
  if (!token) throw new PiCodingAgentServiceError(503, "Learnordie Responses proxy token is not configured.");
  return token;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new PiCodingAgentServiceError(504, "Pi coding-agent run timed out.")), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      }
    );
  });
}

function serviceTimeoutMs(): number {
  return envInt("LEARNORDIE_PI_CODING_AGENT_TIMEOUT_MS", envInt("LEARNBUDDY_PI_CODING_AGENT_TIMEOUT_MS", DEFAULT_SERVICE_TIMEOUT_MS));
}

function providerTimeoutMs(): number {
  return envInt("LEARNORDIE_PI_CODING_AGENT_PROVIDER_TIMEOUT_MS", envInt("LEARNBUDDY_PI_CODING_AGENT_PROVIDER_TIMEOUT_MS", DEFAULT_PROVIDER_TIMEOUT_MS));
}

function maxOutputTokens(): number {
  return envInt("LEARNORDIE_PI_CODING_AGENT_MAX_OUTPUT_TOKENS", envInt("LEARNBUDDY_PI_CODING_AGENT_MAX_OUTPUT_TOKENS", DEFAULT_MAX_OUTPUT_TOKENS));
}

function maxPromptChars(): number {
  return envInt("LEARNORDIE_PI_CODING_AGENT_MAX_PROMPT_CHARS", envInt("LEARNBUDDY_PI_CODING_AGENT_MAX_PROMPT_CHARS", DEFAULT_MAX_PROMPT_CHARS));
}

function maxFiles(): number {
  return envInt("LEARNORDIE_PI_CODING_AGENT_MAX_FILES", DEFAULT_MAX_FILES);
}

function maxFileBytes(): number {
  return envInt("LEARNORDIE_PI_CODING_AGENT_MAX_FILE_BYTES", DEFAULT_MAX_FILE_BYTES);
}

function maxTotalFileBytes(): number {
  return envInt("LEARNORDIE_PI_CODING_AGENT_MAX_TOTAL_FILE_BYTES", DEFAULT_MAX_TOTAL_FILE_BYTES);
}

function maxSnapshotBytes(): number {
  return envInt("LEARNORDIE_PI_CODING_AGENT_MAX_SNAPSHOT_BYTES", DEFAULT_MAX_SNAPSHOT_BYTES);
}

function maxDiffBytes(): number {
  return envInt("LEARNORDIE_PI_CODING_AGENT_MAX_DIFF_BYTES", DEFAULT_MAX_DIFF_BYTES);
}

function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function isRecord(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isVercelPiCodingToolName(value: string): value is VercelPiCodingToolName {
  return (vercelPiCodingToolNames as readonly string[]).includes(value);
}

function piContentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");
  return content
    .map((part) => isRecord(part) && typeof part.text === "string" ? part.text : "")
    .join("");
}

function errorMessageFromPayload(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  if (isRecord(payload.error) && typeof payload.error.message === "string") return payload.error.message;
  if (typeof payload.error === "string") return payload.error;
  return undefined;
}

function numberValue(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function displayPath(cwd: string, filePath: string): string {
  const relative = path.relative(cwd, filePath);
  return relative && !relative.startsWith("..") ? relative : filePath.replace(/^\/+/, "");
}

function splitPatchLines(content: string): string[] {
  if (!content) return [];
  const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (content.endsWith("\n")) lines.pop();
  return lines;
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}
