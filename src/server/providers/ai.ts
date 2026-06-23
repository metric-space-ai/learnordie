import type { Lecture } from "@/lib/types";
import type { RetrievedLectureSource } from "@/server/lecture-retrieval";
import { assertDeploymentFetchEndpoint } from "@/server/providers/endpoint-policy";

export type AIProviderInfo = {
  provider: string;
  model: string;
};

export type AIProviderUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type AIProviderResult = {
  answer: string;
  usage?: AIProviderUsage;
};

export type AIProviderStreamResult = {
  chunks: AsyncIterable<string>;
  completed: Promise<AIProviderResult>;
};

export type AICompleteInput = {
  system: string;
  user: string;
  maxOutputTokens?: number;
  temperature?: number;
  responseFormat?: "json_object";
};

export interface AIProvider {
  readonly info: AIProviderInfo;
  complete(input: AICompleteInput): Promise<AIProviderResult>;
  streamComplete?(input: AICompleteInput): Promise<AIProviderStreamResult>;
  explain(input: {
    lecture: Lecture;
    question: string;
    message: string;
    sources: RetrievedLectureSource[];
  }): Promise<AIProviderResult>;
  streamExplain?(input: {
    lecture: Lecture;
    question: string;
    message: string;
    sources: RetrievedLectureSource[];
  }): Promise<AIProviderStreamResult>;
}

class ScopedDemoAIProvider implements AIProvider {
  readonly info = {
    provider: "learnbuddy-demo",
    model: "scoped-demo"
  };

  async complete(input: AICompleteInput) {
    return {
      answer: input.user
    };
  }

  async streamComplete(input: AICompleteInput) {
    const result = await this.complete(input);
    const chunks = result.answer.match(/.{1,42}(?:\s|$)/g)?.map((chunk) => chunk.trim()).filter(Boolean) ?? [result.answer];
    return {
      chunks: (async function* streamLocalChunks() {
        for (const chunk of chunks) yield `${chunk} `;
      })(),
      completed: Promise.resolve(result)
    };
  }

  async explain(input: { lecture: Lecture; question: string; message: string; sources: RetrievedLectureSource[] }) {
    const lower = input.message.toLowerCase();
    const sourceText = input.sources.map((source) => `${source.sourceRef}: ${source.content}`).join("\n");
    const scopeText = `${lower}\n${sourceText.toLowerCase()}`;
    const inScope =
      scopeText.includes("gleitlager") ||
      scopeText.includes("mischreibung") ||
      scopeText.includes("schmier") ||
      scopeText.includes("welle") ||
      scopeText.includes("stribeck") ||
      scopeText.includes("beispiel") ||
      lower.length < 32;

    if (!inScope) {
      return {
        answer: "Ich kann hier nur zur aktuellen Vorlesung, den Folien und den eingebetteten Übungsfragen helfen."
      };
    }

    const sources = input.sources.length > 0
      ? `\n\nQuellen: ${input.sources.map((source) => source.sourceRef).join("; ")}.`
      : "";

    return {
      answer: `Zur Frage "${input.question}": Entscheidend ist, ob der hydrodynamische Schmierfilm schon trägt. Bei Mischreibung gibt es noch direkten Kontakt, deshalb steigen Verschleiß und Wärme. Ein praktisches Beispiel ist das Anfahren einer schwer belasteten Welle: In dieser Phase hilft zusätzliche Schmierung oder Entlastung.${sources}`
    };
  }

  async streamExplain(input: { lecture: Lecture; question: string; message: string; sources: RetrievedLectureSource[] }) {
    return this.streamComplete({
      system: systemPrompt(),
      user: userPrompt(input),
      maxOutputTokens: 520,
      temperature: 0.2
    });
  }
}

type ProviderErrorResponse = {
  error?: {
    message?: unknown;
  };
};

type OpenAICompatibleResponse = ProviderErrorResponse & {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
    text?: unknown;
  }>;
  output_text?: unknown;
  usage?: unknown;
};

type ResponsesApiResponse = ProviderErrorResponse & {
  id?: unknown;
  output_text?: unknown;
  output?: unknown;
  usage?: unknown;
};

function normalizeChatCompletionsBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  const endpoint = trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/v1/chat/completions`;
  assertDeploymentFetchEndpoint(endpoint, "LEARNBUDDY_AI_BASE_URL");
  return endpoint;
}

function normalizeResponsesBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "") || "https://llm.ctox.dev";
  const endpoint = trimmed.endsWith("/responses") ? trimmed : `${trimmed}/v1/responses`;
  assertDeploymentFetchEndpoint(endpoint, "LEARNBUDDY_LLM_PROXY_BASE_URL");
  return endpoint;
}

function providerTimeoutMs() {
  const configured = Number(process.env.LEARNBUDDY_AI_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? Math.min(60_000, Math.round(configured)) : 15_000;
}

function sourceTextFor(input: { sources: RetrievedLectureSource[] }) {
  return input.sources.length > 0
    ? input.sources.map((source) => `- ${source.sourceRef}: ${source.content}`).join("\n")
    : "- Keine verarbeiteten Zusatzquellen gefunden. Nutze nur die sichtbaren Folien.";
}

function systemPrompt() {
  return [
    "Du bist der LearnBuddy KI-Assistent für eine technische Hochschulvorlesung.",
    "Antworte auf Deutsch, knapp, fachlich und nur im Kontext der Vorlesung.",
    "Nenne keine internen API-Details und keine Modellkonfiguration."
  ].join(" ");
}

function userPrompt(input: { lecture: Lecture; question: string; message: string; sources: RetrievedLectureSource[] }) {
  return [
    `Vorlesung: ${input.lecture.seriesTitle} / ${input.lecture.title}`,
    `Quizfrage: ${input.question}`,
    `Studierendenfrage: ${input.message}`,
    "Relevante Quellen:",
    sourceTextFor(input)
  ].join("\n");
}

function normalizeProviderContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const record = part as Record<string, unknown>;
      if (typeof record.text === "string") return record.text;
      if (typeof record.content === "string") return record.content;
      return "";
    })
    .join("")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function tokenNumber(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue >= 0 ? Math.round(numberValue) : undefined;
}

function normalizeUsage(usage: unknown): AIProviderUsage | undefined {
  if (!isRecord(usage)) return undefined;
  const inputTokens = tokenNumber(usage.prompt_tokens ?? usage.input_tokens);
  const outputTokens = tokenNumber(usage.completion_tokens ?? usage.output_tokens);
  const totalTokens = tokenNumber(usage.total_tokens);
  const result: AIProviderUsage = {};
  if (inputTokens !== undefined) result.inputTokens = inputTokens;
  if (outputTokens !== undefined) result.outputTokens = outputTokens;
  if (totalTokens !== undefined) result.totalTokens = totalTokens;
  return Object.keys(result).length > 0 ? result : undefined;
}

function normalizeResponsesOutputText(payload: ResponsesApiResponse | null): string {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const parts: string[] = [];
  const output = Array.isArray(payload?.output) ? payload.output : [];
  for (const item of output) {
    if (!isRecord(item)) continue;
    if (typeof item.text === "string") parts.push(item.text);
    const content = Array.isArray(item.content) ? item.content : [];
    for (const contentItem of content) {
      if (typeof contentItem === "string") {
        parts.push(contentItem);
        continue;
      }
      if (!isRecord(contentItem)) continue;
      if (typeof contentItem.text === "string") parts.push(contentItem.text);
      if (typeof contentItem.content === "string") parts.push(contentItem.content);
    }
  }

  return parts.join("").trim();
}

function deferredResult<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolveFn, rejectFn) => {
    resolve = resolveFn;
    reject = rejectFn;
  });
  return { promise, resolve, reject };
}

async function* sseDataPayloads(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? "";
      for (const event of events) {
        const lines = event.split(/\r?\n/);
        const data = lines
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice("data:".length).trim())
          .join("\n")
          .trim();
        if (data) yield data;
      }
      if (done) break;
    }
    if (buffer.trim()) {
      const data = buffer
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trim())
        .join("\n")
        .trim();
      if (data) yield data;
    }
  } finally {
    reader.releaseLock();
  }
}

function chatCompletionStreamToken(payload: unknown) {
  if (!isRecord(payload)) return "";
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const firstChoice = isRecord(choices[0]) ? choices[0] : {};
  const delta = isRecord(firstChoice.delta) ? firstChoice.delta : {};
  return normalizeProviderContent(delta.content ?? firstChoice.text);
}

function responseStreamToken(payload: unknown) {
  if (!isRecord(payload)) return "";
  if (payload.type === "response.output_text.done" || payload.type === "response.completed") return "";
  if (payload.type === "response.output_text.delta" && typeof payload.delta === "string") return payload.delta;
  if (typeof payload.delta === "string") return payload.delta;
  if (payload.type === "response.text.delta" && typeof payload.text === "string") return payload.text;
  return "";
}

class OpenAICompatibleProvider implements AIProvider {
  readonly info: AIProviderInfo;
  private readonly endpoint: string;
  private readonly apiKey?: string;

  constructor(input: { endpoint: string; apiKey?: string; model: string }) {
    this.endpoint = input.endpoint;
    this.apiKey = input.apiKey?.trim() || undefined;
    this.info = {
      provider: "openai-compatible",
      model: input.model
    };
  }

  async complete(input: AICompleteInput) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), providerTimeoutMs());

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {})
        },
        body: JSON.stringify({
          model: this.info.model,
          temperature: input.temperature ?? 0.2,
          max_tokens: input.maxOutputTokens ?? 520,
          ...(input.responseFormat === "json_object" ? { response_format: { type: "json_object" } } : {}),
          messages: [
            {
              role: "system",
              content: input.system
            },
            {
              role: "user",
              content: input.user
            }
          ]
        }),
        signal: controller.signal
      });

      const payload = await response.json().catch(() => null) as OpenAICompatibleResponse | null;
      if (!response.ok) {
        const message = typeof payload?.error?.message === "string" ? payload.error.message : `HTTP ${response.status}`;
        throw new Error(`AI provider request failed: ${message}`);
      }

      const content = normalizeProviderContent(payload?.choices?.[0]?.message?.content ?? payload?.choices?.[0]?.text ?? payload?.output_text);
      if (!content) {
        throw new Error("AI provider returned no answer text.");
      }

      return {
        answer: content,
        usage: normalizeUsage(payload?.usage)
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("AI provider request timed out.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async streamComplete(input: AICompleteInput) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), providerTimeoutMs());

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {})
      },
      body: JSON.stringify({
        model: this.info.model,
        temperature: input.temperature ?? 0.2,
        max_tokens: input.maxOutputTokens ?? 520,
        stream: true,
        stream_options: { include_usage: true },
        ...(input.responseFormat === "json_object" ? { response_format: { type: "json_object" } } : {}),
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user }
        ]
      }),
      signal: controller.signal
    }).catch((error) => {
      clearTimeout(timeout);
      if (error instanceof Error && error.name === "AbortError") throw new Error("AI provider request timed out.");
      throw error;
    });

    if (!response.ok || !response.body) {
      clearTimeout(timeout);
      const payload = await response.json().catch(() => null) as OpenAICompatibleResponse | null;
      const message = typeof payload?.error?.message === "string" ? payload.error.message : `HTTP ${response.status}`;
      throw new Error(`AI provider stream failed: ${message}`);
    }

    const completed = deferredResult<AIProviderResult>();
    const stream = sseDataPayloads(response.body);
    const chunks = (async function* parseOpenAiStream() {
      const parts: string[] = [];
      let usage: AIProviderUsage | undefined;
      try {
        for await (const data of stream) {
          if (data === "[DONE]") break;
          const payload = JSON.parse(data) as OpenAICompatibleResponse;
          usage = normalizeUsage(payload.usage) ?? usage;
          const token = chatCompletionStreamToken(payload);
          if (!token) continue;
          parts.push(token);
          yield token;
        }
        const answer = parts.join("").trim();
        if (!answer) throw new Error("AI provider stream returned no answer text.");
        completed.resolve({ answer, usage });
      } catch (error) {
        completed.reject(error);
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    })();

    return {
      chunks,
      completed: completed.promise
    };
  }

  async explain(input: { lecture: Lecture; question: string; message: string; sources: RetrievedLectureSource[] }) {
    return this.complete({
      system: systemPrompt(),
      user: userPrompt(input),
      maxOutputTokens: 520,
      temperature: 0.2
    });
  }

  async streamExplain(input: { lecture: Lecture; question: string; message: string; sources: RetrievedLectureSource[] }) {
    return this.streamComplete({
      system: systemPrompt(),
      user: userPrompt(input),
      maxOutputTokens: 520,
      temperature: 0.2
    });
  }
}

class CtoxResponsesProvider implements AIProvider {
  readonly info: AIProviderInfo;
  private readonly endpoint: string;
  private readonly apiKey: string;

  constructor(input: { endpoint: string; apiKey: string; model: string }) {
    this.endpoint = input.endpoint;
    this.apiKey = input.apiKey.trim();
    this.info = {
      provider: "ctox-responses",
      model: input.model
    };
  }

  async complete(input: AICompleteInput) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), providerTimeoutMs());

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.info.model,
          input: `${input.system}\n\n${input.user}`,
          max_output_tokens: input.maxOutputTokens ?? 520,
          reasoning: { effort: "none" },
          store: false
        }),
        signal: controller.signal
      });

      const payload = await response.json().catch(() => null) as ResponsesApiResponse | null;
      if (!response.ok) {
        const message = typeof payload?.error?.message === "string" ? payload.error.message : `HTTP ${response.status}`;
        throw new Error(`ctox Responses proxy request failed: ${message}`);
      }

      const content = normalizeResponsesOutputText(payload);
      if (!content) {
        throw new Error("ctox Responses proxy returned no answer text.");
      }

      return {
        answer: content,
        usage: normalizeUsage(payload?.usage)
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("ctox Responses proxy request timed out.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async streamComplete(input: AICompleteInput) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), providerTimeoutMs());

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.info.model,
        input: `${input.system}\n\n${input.user}`,
        max_output_tokens: input.maxOutputTokens ?? 520,
        reasoning: { effort: "none" },
        stream: true,
        store: false
      }),
      signal: controller.signal
    }).catch((error) => {
      clearTimeout(timeout);
      if (error instanceof Error && error.name === "AbortError") throw new Error("ctox Responses proxy request timed out.");
      throw error;
    });

    if (!response.ok || !response.body) {
      clearTimeout(timeout);
      const payload = await response.json().catch(() => null) as ResponsesApiResponse | null;
      const message = typeof payload?.error?.message === "string" ? payload.error.message : `HTTP ${response.status}`;
      throw new Error(`ctox Responses proxy stream failed: ${message}`);
    }

    const completed = deferredResult<AIProviderResult>();
    const stream = sseDataPayloads(response.body);
    const chunks = (async function* parseResponsesStream() {
      const parts: string[] = [];
      let usage: AIProviderUsage | undefined;
      try {
        for await (const data of stream) {
          if (data === "[DONE]") break;
          const payload = JSON.parse(data) as ResponsesApiResponse;
          usage = normalizeUsage(payload.usage) ?? usage;
          const token = responseStreamToken(payload);
          if (!token) continue;
          parts.push(token);
          yield token;
        }
        const answer = parts.join("").trim();
        if (!answer) throw new Error("ctox Responses proxy stream returned no answer text.");
        completed.resolve({ answer, usage });
      } catch (error) {
        completed.reject(error);
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    })();

    return {
      chunks,
      completed: completed.promise
    };
  }

  async explain(input: { lecture: Lecture; question: string; message: string; sources: RetrievedLectureSource[] }) {
    return this.complete({
      system: systemPrompt(),
      user: userPrompt(input),
      maxOutputTokens: 520
    });
  }

  async streamExplain(input: { lecture: Lecture; question: string; message: string; sources: RetrievedLectureSource[] }) {
    return this.streamComplete({
      system: systemPrompt(),
      user: userPrompt(input),
      maxOutputTokens: 520
    });
  }
}

function selectedAIProvider() {
  return process.env.LEARNBUDDY_AI_PROVIDER?.trim().toLowerCase();
}

function ctoxResponsesToken() {
  return (
    process.env.LEARNBUDDY_LLM_PROXY_API_KEY ??
    process.env.CTOX_LLM_PROXY_API_KEY ??
    process.env.FALLBACK_LLM_PROXY_TOKEN ??
    process.env.LEARNBUDDY_AI_API_KEY ??
    ""
  ).trim();
}

export function configuredAIProviderInfo(): AIProviderInfo {
  const selected = selectedAIProvider();
  if (selected === "ctox-responses" || selected === "ctox" || selected === "llm.ctox.dev" || selected === "responses") {
    return {
      provider: "ctox-responses",
      model: process.env.LEARNBUDDY_AI_MODEL?.trim() || "MiniMax-M3"
    };
  }

  if (selected === "openai-compatible" || selected === "http") {
    return {
      provider: "openai-compatible",
      model: process.env.LEARNBUDDY_AI_MODEL?.trim() || "learnbuddy-external"
    };
  }

  return {
    provider: "learnbuddy-demo",
    model: "scoped-demo"
  };
}

export function getAIProvider(): AIProvider {
  const selected = selectedAIProvider();
  if (selected === "ctox-responses" || selected === "ctox" || selected === "llm.ctox.dev" || selected === "responses") {
    const apiKey = ctoxResponsesToken();
    if (!apiKey) {
      throw new Error("LEARNBUDDY_LLM_PROXY_API_KEY or CTOX_LLM_PROXY_API_KEY is required for LEARNBUDDY_AI_PROVIDER=ctox-responses.");
    }

    return new CtoxResponsesProvider({
      endpoint: normalizeResponsesBaseUrl(process.env.LEARNBUDDY_LLM_PROXY_BASE_URL ?? process.env.CTOX_LLM_PROXY_BASE_URL ?? process.env.LEARNBUDDY_AI_BASE_URL ?? ""),
      apiKey,
      model: process.env.LEARNBUDDY_AI_MODEL?.trim() || "MiniMax-M3"
    });
  }

  if (selected === "openai-compatible" || selected === "http") {
    const endpoint = normalizeChatCompletionsBaseUrl(process.env.LEARNBUDDY_AI_BASE_URL ?? "");
    if (!endpoint) {
      throw new Error("LEARNBUDDY_AI_BASE_URL is required for LEARNBUDDY_AI_PROVIDER=openai-compatible.");
    }

    return new OpenAICompatibleProvider({
      endpoint,
      apiKey: process.env.LEARNBUDDY_AI_API_KEY,
      model: process.env.LEARNBUDDY_AI_MODEL?.trim() || "learnbuddy-external"
    });
  }

  return new ScopedDemoAIProvider();
}
