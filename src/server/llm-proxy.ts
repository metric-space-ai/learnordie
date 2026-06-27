export const LEARNORDIE_RESPONSES_PROXY_BASE_URL = "https://llm.learnordie.app";
export const LEARNORDIE_RESPONSES_PROVIDER = "learnordie-responses";
export const LEARNORDIE_RESPONSES_MODEL = "MiniMax-M3";

export const MINIMAX_RESPONSES_URL = "https://api.minimax.io/v1/responses";
export const MINIMAX_RESPONSES_INPUT_TOKENS_URL = "https://api.minimax.io/v1/responses/input_tokens";

const DEFAULT_MAX_BODY_CHARS = 200_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 1200;
const MINIMAX_INPUT_ITEM_TYPES = new Set(["message", "function_call", "function_call_output", "reasoning"]);

type JsonObject = Record<string, unknown>;

export class LearnordieLlmProxyError extends Error {
  readonly status: number;
  readonly body: JsonObject;

  constructor(status: number, message: string, param?: string, code = "invalid_request_error") {
    super(message);
    this.status = status;
    this.body = {
      error: {
        message,
        type: "invalid_request_error",
        param: param ?? null,
        code
      }
    };
  }
}

export function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function envInt(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

export function learnordieLlmProxyMaxBodyChars() {
  return envInt("LEARNORDIE_LLM_PROXY_MAX_BODY_CHARS", envInt("LEARNBUDDY_LLM_PROXY_MAX_BODY_CHARS", DEFAULT_MAX_BODY_CHARS));
}

export function learnordieLlmProxyMaxOutputTokens() {
  return envInt("LEARNORDIE_LLM_PROXY_MAX_OUTPUT_TOKENS", envInt("LEARNBUDDY_LLM_PROXY_MAX_OUTPUT_TOKENS", DEFAULT_MAX_OUTPUT_TOKENS));
}

export function configuredLearnordieProxyClientTokens() {
  return [
    process.env.LEARNORDIE_LLM_PROXY_API_KEY,
    process.env.LEARNBUDDY_LLM_PROXY_API_KEY,
    process.env.CTOX_LLM_PROXY_API_KEY,
    process.env.FALLBACK_LLM_PROXY_TOKEN
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
}

export function learnordieMinimaxApiKey() {
  return (process.env.LEARNORDIE_MINIMAX_API_KEY ?? process.env.MINIMAX_API_KEY ?? "").trim();
}

export function authorizeLearnordieProxyRequest(request: Request) {
  const configuredTokens = configuredLearnordieProxyClientTokens();
  if (configuredTokens.length === 0) {
    return {
      ok: false as const,
      status: 503,
      body: { error: "Learnordie LLM proxy is not configured." }
    };
  }

  const auth = request.headers.get("authorization") || "";
  const token = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
  if (!token || !configuredTokens.includes(token)) {
    return {
      ok: false as const,
      status: 403,
      body: { error: "Learnordie LLM proxy access denied." }
    };
  }

  return { ok: true as const };
}

export function normalizeResponsesInput(input: unknown): unknown[] {
  if (input === undefined || input === null) return [];
  if (typeof input === "string") {
    return [
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: input }]
      }
    ];
  }
  if (Array.isArray(input)) return input;
  return [
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: String(input) }]
    }
  ];
}

function rejectUnsupportedMiniMaxFeatures(payload: JsonObject) {
  if (payload.previous_response_id !== undefined && payload.previous_response_id !== null) {
    throw new LearnordieLlmProxyError(
      400,
      "Learnordie MiniMax-M3 proxy does not store response state yet; send full input instead of previous_response_id.",
      "previous_response_id",
      "unsupported_parameter"
    );
  }
  if (payload.conversation !== undefined && payload.conversation !== null) {
    throw new LearnordieLlmProxyError(400, "Learnordie MiniMax-M3 proxy does not support OpenAI conversation resources.", "conversation", "unsupported_parameter");
  }
  if (payload.background === true) {
    throw new LearnordieLlmProxyError(400, "Learnordie MiniMax-M3 proxy does not support background responses.", "background", "unsupported_parameter");
  }
  if (payload.prompt !== undefined && payload.prompt !== null) {
    throw new LearnordieLlmProxyError(400, "Learnordie MiniMax-M3 proxy does not support OpenAI prompt templates.", "prompt", "unsupported_parameter");
  }
  if (payload.max_tool_calls !== undefined && payload.max_tool_calls !== null) {
    throw new LearnordieLlmProxyError(400, "Learnordie MiniMax-M3 proxy does not support max_tool_calls.", "max_tool_calls", "unsupported_parameter");
  }
  if (Array.isArray(payload.include) && payload.include.length > 0) {
    throw new LearnordieLlmProxyError(400, "Learnordie MiniMax-M3 proxy does not support non-empty include lists.", "include", "unsupported_parameter");
  }
  if (payload.truncation !== undefined && payload.truncation !== null && payload.truncation !== "disabled") {
    throw new LearnordieLlmProxyError(400, "Learnordie MiniMax-M3 proxy only supports truncation='disabled'.", "truncation", "unsupported_parameter");
  }
  if (isJsonObject(payload.text) && isJsonObject(payload.text.format) && payload.text.format.type !== undefined && payload.text.format.type !== "text") {
    throw new LearnordieLlmProxyError(400, "Learnordie MiniMax-M3 proxy only supports text.format.type='text'.", "text.format", "unsupported_parameter");
  }
  if (
    payload.tool_choice !== undefined &&
    payload.tool_choice !== null &&
    !(typeof payload.tool_choice === "string" && ["auto", "none"].includes(payload.tool_choice))
  ) {
    throw new LearnordieLlmProxyError(400, "Learnordie MiniMax-M3 proxy only supports tool_choice 'auto' or 'none'.", "tool_choice", "unsupported_parameter");
  }
  if (Array.isArray(payload.tools)) {
    const unsupported = payload.tools.find((tool) => isJsonObject(tool) && tool.type !== "function");
    if (unsupported) {
      throw new LearnordieLlmProxyError(400, "Learnordie MiniMax-M3 proxy supports function tools, not built-in OpenAI tools.", "tools", "unsupported_tool");
    }
  }
}

function rejectUnsupportedMiniMaxInputItems(items: unknown[]) {
  for (const item of items) {
    if (!isJsonObject(item)) {
      throw new LearnordieLlmProxyError(400, "Learnordie MiniMax-M3 proxy only supports object input items.", "input", "unsupported_item");
    }
    const type = typeof item.type === "string" && item.type ? item.type : "message";
    if (!MINIMAX_INPUT_ITEM_TYPES.has(type)) {
      throw new LearnordieLlmProxyError(400, `Learnordie MiniMax-M3 proxy does not support input item type '${type}'.`, "input", "unsupported_item");
    }
    if ((type === "function_call" || type === "function_call_output") && typeof item.call_id !== "string") {
      throw new LearnordieLlmProxyError(400, "Function call input items require a call_id.", "input", "invalid_request_error");
    }
  }
}

function sanitizedMiniMaxPayload(payload: JsonObject) {
  const upstream: JsonObject = { ...payload };
  delete upstream.previous_response_id;
  delete upstream.conversation;
  delete upstream.store;
  delete upstream.include;
  delete upstream.service_tier;
  delete upstream.background;
  delete upstream.max_tool_calls;
  delete upstream.parallel_tool_calls;
  delete upstream.prompt;
  delete upstream.user;
  delete upstream.truncation;

  return upstream;
}

export function prepareLearnordieResponsesRequest(raw: unknown) {
  if (!isJsonObject(raw)) {
    throw new LearnordieLlmProxyError(400, "Learnordie LLM proxy expects a JSON object.");
  }

  rejectUnsupportedMiniMaxFeatures(raw);
  const inputItems = normalizeResponsesInput(raw.input);
  rejectUnsupportedMiniMaxInputItems(inputItems);

  const cap = learnordieLlmProxyMaxOutputTokens();
  const requested = Number(raw.max_output_tokens);
  const maxOutputTokens = Number.isFinite(requested) && requested > 0
    ? Math.min(Math.floor(requested), cap)
    : cap;

  return sanitizedMiniMaxPayload({
    ...raw,
    model: LEARNORDIE_RESPONSES_MODEL,
    input: inputItems,
    max_output_tokens: maxOutputTokens
  });
}

export function prepareLearnordieInputTokensRequest(raw: unknown) {
  const upstream = prepareLearnordieResponsesRequest(raw);
  delete upstream.stream;
  delete upstream.max_output_tokens;
  delete upstream.metadata;
  return upstream;
}

export function proxyResponseHeaders(upstream: Response) {
  const headers = new Headers();
  const contentType = upstream.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  headers.set("cache-control", "no-store");
  headers.set("x-learnordie-llm-proxy", "minimax-m3");
  return headers;
}
