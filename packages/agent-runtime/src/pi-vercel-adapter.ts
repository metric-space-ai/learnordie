import {
  runAgentLoop,
  type AgentContext as PiAgentContext,
  type AgentEvent as PiAgentEvent,
  type AgentMessage as PiAgentMessage,
  type AgentTool as PiAgentTool
} from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import {
  type Api,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Context as PiLlmContext,
  type Message as PiMessage,
  type Model,
  type ToolResultMessage,
  type Usage
} from "@earendil-works/pi-ai";

export type PiVercelUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type PiVercelCompletionResult = {
  answer: string;
  provider?: string;
  model?: string;
  usage?: PiVercelUsage;
};

export type PiVercelTool<TName extends string> = {
  name: TName;
  label: string;
  description: string;
  input: unknown;
  execute: () => Promise<unknown> | unknown;
};

export type PiVercelToolRun<TName extends string> = {
  id: string;
  toolName: TName;
  input: unknown;
  output?: unknown;
  status: "running" | "succeeded" | "failed";
  durationMs: number;
  error?: string;
  createdAt: string;
};

export type PiVercelTurnResult<TName extends string> = {
  assistantText: string;
  provider?: string;
  model?: string;
  usage?: PiVercelUsage;
  toolOutputs: Partial<Record<TName, unknown>>;
  toolRuns: PiVercelToolRun<TName>[];
  piEvents: PiAgentEvent[];
  piMessages: PiAgentMessage[];
};

export type RunPiVercelTurnInput<TName extends string> = {
  prompt: string;
  systemPrompt: string;
  tools: PiVercelTool<TName>[];
  maxOutputTokens?: number;
  temperature?: number;
  complete?: (input: {
    prompt: string;
    toolOutputs: Partial<Record<TName, unknown>>;
    toolResults: ToolResultMessage[];
  }) => Promise<PiVercelCompletionResult>;
};

const PI_VERCEL_MODEL = {
  id: "learnordie-vercel-pi-port",
  name: "Learnordie Vercel Pi Port",
  api: "learnordie-ai-provider" as Api,
  provider: "learnordie",
  baseUrl: "",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 0,
  maxTokens: 0
} satisfies Model<Api>;

const EMPTY_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
};

export async function runPiVercelTurn<TName extends string>(
  input: RunPiVercelTurnInput<TName>
): Promise<PiVercelTurnResult<TName>> {
  const toolOutputs: Partial<Record<TName, unknown>> = {};
  const toolRuns: PiVercelToolRun<TName>[] = [];
  const piEvents: PiAgentEvent[] = [];
  let completion: PiVercelCompletionResult | undefined;

  const piTools = input.tools.map((tool): PiAgentTool => ({
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: Type.Object({}),
    executionMode: "sequential",
    async execute(toolCallId) {
      const run: PiVercelToolRun<TName> = {
        id: toolCallId,
        toolName: tool.name,
        input: tool.input,
        status: "running",
        durationMs: 0,
        createdAt: new Date().toISOString()
      };
      toolRuns.push(run);
      const startedAt = Date.now();
      try {
        const output = await tool.execute();
        toolOutputs[tool.name] = output;
        run.output = output;
        run.status = "succeeded";
        run.durationMs = Date.now() - startedAt;
        return {
          content: [{ type: "text" as const, text: stringifyToolOutput(output) }],
          details: output
        };
      } catch (error) {
        run.status = "failed";
        run.durationMs = Date.now() - startedAt;
        run.error = error instanceof Error ? error.message : "Unknown Pi tool error.";
        throw error;
      }
    }
  }));

  const streamFn = (_model: Model<Api>, context: PiLlmContext): AssistantMessageEventStream => {
    const stream = new LearnordiePiMessageEventStream();
    void (async () => {
      try {
        const toolResults = context.messages.filter(isToolResultMessage);
        if (toolResults.length === 0 && piTools.length > 0) {
          stream.push({
            type: "done",
            reason: "toolUse",
            message: createToolCallMessage(piTools.map((tool) => tool.name))
          });
          return;
        }

        completion = input.complete
          ? await input.complete({ prompt: input.prompt, toolOutputs, toolResults })
          : { answer: "" };
        stream.push({
          type: "done",
          reason: "stop",
          message: createTextMessage(completion.answer, completion)
        });
      } catch (error) {
        stream.push({
          type: "error",
          reason: "error",
          error: createErrorMessage(error)
        });
      }
    })();
    return stream as unknown as AssistantMessageEventStream;
  };

  const config = {
    model: PI_VERCEL_MODEL,
    maxTokens: input.maxOutputTokens,
    temperature: input.temperature,
    convertToLlm: (messages: PiAgentMessage[]) => messages.filter(isPiMessage),
    toolExecution: "sequential" as const,
    shouldStopAfterTurn: ({ message }: { message: PiAgentMessage }) => (
      message.role === "assistant" && !message.content.some((part) => part.type === "toolCall")
    )
  };
  const context: PiAgentContext = {
    systemPrompt: input.systemPrompt,
    messages: [],
    tools: piTools
  };
  const promptMessage: PiMessage = {
    role: "user",
    content: input.prompt,
    timestamp: Date.now()
  };

  const piMessages = await runAgentLoop([promptMessage], context, config, (event) => {
    piEvents.push(event);
  }, undefined, streamFn);

  return {
    assistantText: completion?.answer ?? extractAssistantText(piMessages),
    provider: completion?.provider,
    model: completion?.model,
    usage: completion?.usage,
    toolOutputs,
    toolRuns,
    piEvents,
    piMessages
  };
}

class LearnordiePiMessageEventStream {
  private readonly queue: AssistantMessageEvent[] = [];
  private readonly waiters: Array<(value: IteratorResult<AssistantMessageEvent>) => void> = [];
  private done = false;
  private resolveResult!: (message: AssistantMessage) => void;
  private readonly resultPromise = new Promise<AssistantMessage>((resolve) => {
    this.resolveResult = resolve;
  });

  push(event: AssistantMessageEvent): void {
    if (this.done) return;
    if (event.type === "done" || event.type === "error") {
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

  end(result?: AssistantMessage): void {
    this.done = true;
    if (result) this.resolveResult(result);
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter?.({ value: undefined, done: true });
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<AssistantMessageEvent> {
    while (true) {
      const event = this.queue.shift();
      if (event) {
        yield event;
        continue;
      }
      if (this.done) return;
      const result = await new Promise<IteratorResult<AssistantMessageEvent>>((resolve) => {
        this.waiters.push(resolve);
      });
      if (result.done) return;
      yield result.value;
    }
  }

  result(): Promise<AssistantMessage> {
    return this.resultPromise;
  }
}

function createToolCallMessage(toolNames: string[]): AssistantMessage {
  return {
    role: "assistant",
    content: toolNames.map((name) => ({
      type: "toolCall" as const,
      id: `learnordie-${name}`,
      name,
      arguments: {}
    })),
    api: PI_VERCEL_MODEL.api,
    provider: PI_VERCEL_MODEL.provider,
    model: PI_VERCEL_MODEL.id,
    usage: EMPTY_USAGE,
    stopReason: "toolUse",
    timestamp: Date.now()
  };
}

function createTextMessage(text: string, completion: PiVercelCompletionResult): AssistantMessage {
  return {
    role: "assistant",
    content: text ? [{ type: "text", text }] : [],
    api: PI_VERCEL_MODEL.api,
    provider: completion.provider ?? PI_VERCEL_MODEL.provider,
    model: completion.model ?? PI_VERCEL_MODEL.id,
    usage: usageFromCompletion(completion.usage),
    stopReason: "stop",
    timestamp: Date.now()
  };
}

function createErrorMessage(error: unknown): AssistantMessage {
  const message = error instanceof Error ? error.message : "Unknown Pi completion error.";
  return {
    role: "assistant",
    content: [{ type: "text", text: message }],
    api: PI_VERCEL_MODEL.api,
    provider: PI_VERCEL_MODEL.provider,
    model: PI_VERCEL_MODEL.id,
    usage: EMPTY_USAGE,
    stopReason: "error",
    errorMessage: message,
    timestamp: Date.now()
  };
}

function usageFromCompletion(usage: PiVercelUsage | undefined): Usage {
  if (!usage) return EMPTY_USAGE;
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  return {
    input,
    output,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: usage.totalTokens ?? input + output,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  };
}

function isToolResultMessage(message: PiMessage): message is ToolResultMessage {
  return message.role === "toolResult";
}

function isPiMessage(message: PiAgentMessage): message is PiMessage {
  return (
    message.role === "user" ||
    message.role === "assistant" ||
    message.role === "toolResult"
  );
}

function extractAssistantText(messages: PiAgentMessage[]) {
  const assistant = [...messages].reverse().find((message): message is AssistantMessage => message.role === "assistant");
  return assistant?.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
    .trim() ?? "";
}

function stringifyToolOutput(output: unknown) {
  try {
    return truncate(JSON.stringify(output), 4000);
  } catch {
    return truncate(String(output), 4000);
  }
}

function truncate(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}
