#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createHash } from "node:crypto";

const DEFAULT_TIMEOUT_MS = 15_000;
const EMBEDDING_DIMENSIONS = 1536;
const ALL_CHECKS = ["ai", "lecturer_assistant", "chat_moderation", "question_generator", "embedding", "ocr", "storage", "mail", "stt"];

const HELP_TEXT = `
Usage: npm run provider:smoke -- [options]

Runs active learnordie.app provider roundtrips and prints a machine-readable JSON result.

Options:
  --profile local|preview|production
                                    Controls strictness for provider-backed checks.
  --only <csv>                      Restrict checks to: ${ALL_CHECKS.join(",")}.
  --mock                            Start local provider mocks instead of calling real services.
                                    If LEARNBUDDY_AI_PROVIDER is learnordie-responses or ctox-responses,
                                    the mock exercises /v1/responses.
  --mock-port <port>                Port for the mock provider server. Defaults to 0.

Examples:
  npm run provider:smoke -- --profile production --only ai,mail,stt
  npm run provider:smoke -- --profile production --mock --only ai,lecturer_assistant,chat_moderation,question_generator,embedding,ocr,storage,mail,stt
`;

function parseArgs() {
  const result = new Map();
  for (let index = 2; index < process.argv.length; index += 1) {
    const item = process.argv[index];
    if (!item.startsWith("--")) continue;
    const [rawKey, inlineValue] = item.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      result.set(rawKey, inlineValue);
      continue;
    }
    const next = process.argv[index + 1];
    if (!next || next.startsWith("--")) {
      result.set(rawKey, "1");
      continue;
    }
    result.set(rawKey, next);
    index += 1;
  }
  return result;
}

function helpRequested() {
  return process.argv.slice(2).some((item) => item === "-h" || item === "--help" || item.startsWith("--help="));
}

if (helpRequested()) {
  console.log(HELP_TEXT.trim());
  process.exit(0);
}

const args = parseArgs();
const profile = (args.get("profile") || process.env.LEARNBUDDY_PROVIDER_SMOKE_PROFILE || process.env.LEARNBUDDY_DEPLOYMENT_ENV || "local").toLowerCase();
const productionLike = profile === "production" || profile === "preview";
const only = args.get("only")
  ? new Set(String(args.get("only")).split(",").map((item) => item.trim()).filter(Boolean))
  : null;
const useMock = args.has("mock") || process.env.LEARNBUDDY_PROVIDER_SMOKE_MOCK === "1";
const checks = [];
let mockServer;

function unknownOnlyChecks() {
  if (!only) return [];
  return [...only].filter((id) => !ALL_CHECKS.includes(id));
}

function shouldRun(id) {
  return !only || only.has(id);
}

function envValue(name) {
  return (process.env[name] ?? "").trim();
}

function secretValues() {
  return Object.entries(process.env)
    .filter(([key, value]) => value && /(KEY|TOKEN|SECRET|PASSWORD|AUTH)/i.test(key))
    .map(([, value]) => String(value))
    .filter((value) => value.length >= 8);
}

function sanitize(value) {
  let text = value instanceof Error ? value.message : String(value);
  for (const secret of secretValues()) {
    text = text.split(secret).join("[secret]");
  }
  return text.replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [secret]");
}

function record(id, status, message, details = {}) {
  checks.push({
    id,
    status,
    message: sanitize(message),
    details
  });
}

function pass(id, message, details) {
  record(id, "pass", message, details);
}

function warn(id, message, details) {
  record(id, "warn", message, details);
}

function skip(id, message, details) {
  record(id, "skip", message, details);
}

function fail(id, message, details) {
  record(id, "fail", message, details);
}

function providerTimeoutMs(prefix) {
  const configured = Number(envValue(`${prefix}_TIMEOUT_MS`));
  return Number.isFinite(configured) && configured > 0
    ? Math.min(60_000, Math.round(configured))
    : DEFAULT_TIMEOUT_MS;
}

async function fetchJson(url, init, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let payload = null;
    if (text.trim()) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }
    return { response, payload, text };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url, init, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    return { response, text };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function wsMessagePayload(event) {
  const raw = typeof event.data === "string" ? event.data : "";
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function realtimeDeltaText(payload) {
  const type = String(payload?.type ?? "").toLowerCase();
  if (!type.includes("transcri") && !type.includes("audio")) return "";
  return String(payload?.delta ?? payload?.text ?? "").trim();
}

function nestedTranscriptText(value) {
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) {
    return value.map(nestedTranscriptText).filter(Boolean).join(" ").trim();
  }
  for (const key of ["transcript", "text", "output_text"]) {
    if (typeof value[key] === "string" && value[key].trim()) return value[key].trim();
  }
  return Object.values(value).map(nestedTranscriptText).filter(Boolean).join(" ").trim();
}

function realtimeFinalText(payload) {
  const type = String(payload?.type ?? "").toLowerCase();
  if (!type.includes("done") && !type.includes("completed")) return "";
  return nestedTranscriptText(payload) || nestedTranscriptText(payload?.response) || nestedTranscriptText(payload?.item);
}

async function realtimeSttRoundtrip(endpoint, apiKey, model, audio, timeoutMs) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let settled = false;
    const ws = new WebSocket(endpoint, {
      headers: {
        authorization: `Bearer ${apiKey}`
      }
    });

    const finish = (error, text) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      try {
        ws.close();
      } catch {
        // noop
      }
      if (error) reject(error);
      else resolve((text || chunks.join(" ")).replace(/\s+/g, " ").trim());
    };

    const timeout = setTimeout(() => finish(new Error(`Realtime STT timed out after ${timeoutMs}ms.`)), timeoutMs);

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ type: "session.update", model }));
      ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: Buffer.from(audio).toString("base64") }));
      ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
    });

    ws.addEventListener("message", (event) => {
      const payload = wsMessagePayload(event);
      if (!payload) return;
      const providerError = typeof payload?.error?.message === "string" ? payload.error.message : "";
      if (providerError) {
        finish(new Error(`Realtime STT provider returned an error: ${providerError}`));
        return;
      }
      const delta = realtimeDeltaText(payload);
      if (delta) chunks.push(delta);
      const final = realtimeFinalText(payload);
      if (final) finish(null, final);
      const type = String(payload?.type ?? "").toLowerCase();
      if ((type.includes("done") || type.includes("completed")) && chunks.length > 0) {
        finish(null, chunks.join(" "));
      }
    });

    ws.addEventListener("error", () => finish(new Error("Realtime STT websocket failed.")));
    ws.addEventListener("close", () => {
      if (chunks.length > 0) finish(null, chunks.join(" "));
      else finish(new Error("Realtime STT websocket closed without transcript text."));
    });
  });
}

function endpointHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return "invalid";
  }
}

function normalizeHostname(hostname) {
  return hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
}

function ipv4Octets(address) {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return parts;
}

function isPrivateIpv4(address) {
  const octets = ipv4Octets(address);
  if (!octets) return false;
  const [first, second, third] = octets;
  return first === 0 ||
    first === 10 ||
    first === 127 ||
    first >= 224 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && (second === 0 || second === 168)) ||
    (first === 198 && (second === 18 || second === 19 || (second === 51 && third === 100))) ||
    (first === 203 && second === 0 && third === 113);
}

function isPrivateIpv6(address) {
  const lower = normalizeHostname(address);
  const mappedIpv4 = lower.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mappedIpv4) return isPrivateIpv4(mappedIpv4[1]);
  if (lower === "::" || lower === "::1") return true;
  if (lower.startsWith("2001:db8:") || lower === "2001:db8::") return true;

  const firstSegment = Number.parseInt(lower.split(":")[0] || "0", 16);
  if (!Number.isFinite(firstSegment)) return false;
  return (firstSegment >= 0xfc00 && firstSegment <= 0xfdff) ||
    (firstSegment >= 0xfe80 && firstSegment <= 0xfebf) ||
    (firstSegment >= 0xff00 && firstSegment <= 0xffff);
}

function isLocalOrPrivateEndpointHost(hostname) {
  const lower = normalizeHostname(hostname);
  if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local")) return true;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(lower)) return isPrivateIpv4(lower);
  if (lower.includes(":")) return isPrivateIpv6(lower);
  return false;
}

function assertProductionSmokeEndpoint(endpoint, label) {
  if (!endpoint || !productionLike || useMock) return endpoint;
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new Error(`${label} must be a valid HTTP(S) URL for ${profile} provider smoke.`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label} must be an HTTP(S) URL for ${profile} provider smoke.`);
  }
  if (isLocalOrPrivateEndpointHost(parsed.hostname)) {
    throw new Error(`${label} must not point to local/private network targets for ${profile} provider smoke.`);
  }
  return endpoint;
}

function normalizeChatEndpoint(value) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  const endpoint = trimmed.endsWith("/chat/completions") ? trimmed : `${trimmed}/v1/chat/completions`;
  return assertProductionSmokeEndpoint(endpoint, "LEARNBUDDY_AI_BASE_URL");
}

function normalizeResponsesEndpoint(value) {
  const trimmed = value.trim().replace(/\/+$/, "") || "https://llm.learnordie.app";
  const endpoint = trimmed.endsWith("/responses") ? trimmed : `${trimmed}/v1/responses`;
  return assertProductionSmokeEndpoint(endpoint, "LEARNBUDDY_LLM_PROXY_BASE_URL/CTOX_LLM_PROXY_BASE_URL");
}

function normalizeEmbeddingEndpoint(value) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  const endpoint = trimmed.endsWith("/embeddings") ? trimmed : `${trimmed}/v1/embeddings`;
  return assertProductionSmokeEndpoint(endpoint, "LEARNBUDDY_EMBEDDING_BASE_URL");
}

function normalizeSttEndpoint(value) {
  const base = value.trim().replace(/\/+$/, "") || "https://api.mistral.ai";
  const endpoint = base.endsWith("/audio/transcriptions")
    ? base
    : base.endsWith("/v1")
      ? `${base}/audio/transcriptions`
      : `${base}/v1/audio/transcriptions`;
  return assertProductionSmokeEndpoint(endpoint, "LEARNBUDDY_STT_BASE_URL/MISTRAL_STT_BASE_URL");
}

function normalizeRealtimeSttEndpoint(value) {
  const configured = value.trim().replace(/\/+$/, "");
  if (!configured) return "";
  const parsed = new URL(configured);
  if (!["http:", "https:", "ws:", "wss:"].includes(parsed.protocol)) {
    throw new Error("LEARNBUDDY_STT_REALTIME_BASE_URL/LEARNBUDDY_STT_BASE_URL must be HTTP(S) or WS(S).");
  }
  const basePath = parsed.pathname.replace(/\/+$/, "");
  parsed.pathname = basePath.endsWith("/realtime")
    ? basePath
    : basePath.endsWith("/v1")
      ? `${basePath}/realtime`
      : `${basePath}/v1/realtime`;
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : parsed.protocol === "http:" ? "ws:" : parsed.protocol;
  parsed.search = "";
  const validationUrl = new URL(parsed.toString());
  validationUrl.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
  assertProductionSmokeEndpoint(validationUrl.toString(), "LEARNBUDDY_STT_REALTIME_BASE_URL/LEARNBUDDY_STT_BASE_URL");
  return parsed.toString();
}

function normalizeOcrEndpoint(value) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  const endpoint = trimmed.endsWith("/ocr") ? trimmed : `${trimmed}/v1/ocr`;
  return assertProductionSmokeEndpoint(endpoint, "LEARNBUDDY_OCR_BASE_URL");
}

function normalizeStorageEndpoint(value) {
  const endpoint = value.trim().replace(/\/+$/, "");
  if (!endpoint) return "";
  const parsed = new URL(endpoint);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Storage endpoint must be HTTP(S).");
  }
  return assertProductionSmokeEndpoint(parsed.toString().replace(/\/+$/, ""), "LEARNBUDDY_STORAGE_ENDPOINT");
}

function normalizeOptionalHttpBaseUrl(value, label) {
  const endpoint = value.trim().replace(/\/+$/, "");
  if (!endpoint) return "";
  const parsed = new URL(endpoint);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`${label} must be HTTP(S).`);
  }
  return assertProductionSmokeEndpoint(parsed.toString().replace(/\/+$/, ""), label);
}

function selectedAIProvider() {
  return envValue("LEARNBUDDY_AI_PROVIDER").toLowerCase() || "learnbuddy-demo";
}

function selectedLecturerAssistantProvider() {
  return envValue("LEARNBUDDY_LECTURER_ASSISTANT_PROVIDER").toLowerCase() || "local";
}

function selectedChatModerationProvider() {
  return envValue("LEARNBUDDY_CHAT_MODERATION_PROVIDER").toLowerCase() || "local";
}

function selectedQuestionGenerator() {
  return envValue("LEARNBUDDY_QUESTION_GENERATOR").toLowerCase() || "local";
}

function selectedEmbeddingProvider() {
  return envValue("LEARNBUDDY_EMBEDDING_PROVIDER").toLowerCase() || "learnbuddy-local-hash-v1";
}

function selectedOCRProvider() {
  return envValue("LEARNBUDDY_OCR_PROVIDER").toLowerCase() || "disabled";
}

function selectedStorageProvider() {
  return envValue("LEARNBUDDY_STORAGE_PROVIDER").toLowerCase() || "local";
}

function selectedMailProvider() {
  return envValue("LEARNBUDDY_MAIL_PROVIDER").toLowerCase() || (envValue("RESEND_API_KEY") ? "resend" : "console");
}

function selectedSTTProvider() {
  const selected = envValue("LEARNBUDDY_STT_PROVIDER").toLowerCase();
  if (selected) return selected;
  if (envValue("LEARNBUDDY_STT_API_KEY")) return "openai-compatible";
  return envValue("MISTRAL_API_KEY") ? "mistral-voxtral" : "local";
}

function responsesProxyToken() {
  return (
    envValue("LEARNORDIE_LLM_PROXY_API_KEY") ||
    envValue("LEARNBUDDY_LLM_PROXY_API_KEY") ||
    envValue("CTOX_LLM_PROXY_API_KEY") ||
    envValue("FALLBACK_LLM_PROXY_TOKEN") ||
    envValue("LEARNBUDDY_AI_API_KEY")
  );
}

function isResponsesProxyProvider(provider) {
  return ["learnordie-responses", "learnordie", "llm.learnordie.app", "ctox-responses", "ctox", "llm.ctox.dev", "responses"].includes(provider);
}

function responsesProxyProviderName(provider) {
  return provider === "ctox-responses" || provider === "ctox" || provider === "llm.ctox.dev"
    ? "ctox-responses"
    : "learnordie-responses";
}

function extractResponsesText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) return payload.output_text.trim();
  const output = Array.isArray(payload?.output) ? payload.output : [];
  return output
    .flatMap((item) => Array.isArray(item?.content) ? item.content : [item])
    .map((item) => (typeof item?.text === "string" ? item.text : typeof item?.content === "string" ? item.content : ""))
    .join("")
    .trim();
}

function extractUsage(payload) {
  const usage = payload?.usage;
  if (!usage || typeof usage !== "object") return undefined;
  return {
    inputTokens: Number.isFinite(Number(usage.prompt_tokens ?? usage.input_tokens)) ? Number(usage.prompt_tokens ?? usage.input_tokens) : undefined,
    outputTokens: Number.isFinite(Number(usage.completion_tokens ?? usage.output_tokens)) ? Number(usage.completion_tokens ?? usage.output_tokens) : undefined,
    totalTokens: Number.isFinite(Number(usage.total_tokens)) ? Number(usage.total_tokens) : undefined
  };
}

function streamDataPayloads(text) {
  return text
    .split(/\r?\n\r?\n/)
    .map((event) => event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim())
      .join("\n")
      .trim())
    .filter(Boolean);
}

function streamUsage(payload) {
  return extractUsage(payload) ?? extractUsage(payload?.response);
}

function chatStreamToken(payload) {
  const choice = Array.isArray(payload?.choices) ? payload.choices[0] : undefined;
  return String(choice?.delta?.content ?? choice?.text ?? "");
}

function responsesStreamToken(payload) {
  if (payload?.type === "response.output_text.done" || payload?.type === "response.completed") return "";
  if (payload?.type === "response.output_text.delta" && typeof payload.delta === "string") return payload.delta;
  if (typeof payload?.delta === "string") return payload.delta;
  if (payload?.type === "response.text.delta" && typeof payload.text === "string") return payload.text;
  return "";
}

function parseStreamText(text, tokenExtractor) {
  const parts = [];
  let usage;
  for (const data of streamDataPayloads(text)) {
    if (data === "[DONE]") break;
    const payload = JSON.parse(data);
    usage = streamUsage(payload) ?? usage;
    const token = tokenExtractor(payload);
    if (token) parts.push(token);
  }
  const answer = parts.join("").trim();
  if (!answer) throw new Error("Provider stream returned no answer text.");
  return { answer, usage };
}

async function completeAI(input) {
  const provider = selectedAIProvider();
  const model = envValue("LEARNBUDDY_AI_MODEL") || (isResponsesProxyProvider(provider) ? "MiniMax-M3" : "learnbuddy-external");

  if (isResponsesProxyProvider(provider)) {
    const token = responsesProxyToken();
    if (!token) throw new Error("Responses proxy token is missing.");
    const endpoint = normalizeResponsesEndpoint(envValue("LEARNORDIE_LLM_PROXY_BASE_URL") || envValue("LEARNBUDDY_LLM_PROXY_BASE_URL") || envValue("CTOX_LLM_PROXY_BASE_URL") || envValue("LEARNBUDDY_AI_BASE_URL"));
    const { response, payload } = await fetchJson(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        model,
        input: `${input.system}\n\n${input.user}`,
        max_output_tokens: input.maxOutputTokens ?? 80,
        reasoning: { effort: "none" },
        store: false
      })
    }, providerTimeoutMs("LEARNBUDDY_AI"));
    if (!response.ok) throw new Error(`Responses proxy returned HTTP ${response.status}.`);
    const answer = extractResponsesText(payload);
    if (!answer) throw new Error("Responses proxy returned no answer text.");
    return { provider: responsesProxyProviderName(provider), model, answer, usage: extractUsage(payload), endpointHost: endpointHost(endpoint) };
  }

  if (provider === "openai-compatible" || provider === "http") {
    const endpoint = normalizeChatEndpoint(envValue("LEARNBUDDY_AI_BASE_URL"));
    if (!endpoint) throw new Error("LEARNBUDDY_AI_BASE_URL is missing.");
    const apiKey = envValue("LEARNBUDDY_AI_API_KEY");
    if (productionLike && !apiKey) throw new Error("LEARNBUDDY_AI_API_KEY is missing.");
    const { response, payload } = await fetchJson(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: input.maxOutputTokens ?? 80,
        ...(input.responseFormat === "json_object" ? { response_format: { type: "json_object" } } : {}),
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user }
        ]
      })
    }, providerTimeoutMs("LEARNBUDDY_AI"));
    if (!response.ok) throw new Error(`OpenAI-compatible provider returned HTTP ${response.status}.`);
    const answer = String(payload?.choices?.[0]?.message?.content ?? payload?.choices?.[0]?.text ?? payload?.output_text ?? "").trim();
    if (!answer) throw new Error("OpenAI-compatible provider returned no answer text.");
    return { provider: "openai-compatible", model, answer, usage: extractUsage(payload), endpointHost: endpointHost(endpoint) };
  }

  throw new Error(`AI provider "${provider}" is local or unsupported for active smoke.`);
}

async function streamAI(input) {
  const provider = selectedAIProvider();
  const model = envValue("LEARNBUDDY_AI_MODEL") || (isResponsesProxyProvider(provider) ? "MiniMax-M3" : "learnbuddy-external");

  if (isResponsesProxyProvider(provider)) {
    const token = responsesProxyToken();
    if (!token) throw new Error("Responses proxy token is missing.");
    const endpoint = normalizeResponsesEndpoint(envValue("LEARNORDIE_LLM_PROXY_BASE_URL") || envValue("LEARNBUDDY_LLM_PROXY_BASE_URL") || envValue("CTOX_LLM_PROXY_BASE_URL") || envValue("LEARNBUDDY_AI_BASE_URL"));
    const { response, text } = await fetchText(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        model,
        input: `${input.system}\n\n${input.user}`,
        max_output_tokens: input.maxOutputTokens ?? 80,
        reasoning: { effort: "none" },
        stream: true,
        store: false
      })
    }, providerTimeoutMs("LEARNBUDDY_AI"));
    if (!response.ok) throw new Error(`Responses proxy stream returned HTTP ${response.status}.`);
    const parsed = parseStreamText(text, responsesStreamToken);
    return { provider: responsesProxyProviderName(provider), model, answer: parsed.answer, usage: parsed.usage, endpointHost: endpointHost(endpoint) };
  }

  if (provider === "openai-compatible" || provider === "http") {
    const endpoint = normalizeChatEndpoint(envValue("LEARNBUDDY_AI_BASE_URL"));
    if (!endpoint) throw new Error("LEARNBUDDY_AI_BASE_URL is missing.");
    const apiKey = envValue("LEARNBUDDY_AI_API_KEY");
    if (productionLike && !apiKey) throw new Error("LEARNBUDDY_AI_API_KEY is missing.");
    const { response, text } = await fetchText(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: input.maxOutputTokens ?? 80,
        stream: true,
        stream_options: { include_usage: true },
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user }
        ]
      })
    }, providerTimeoutMs("LEARNBUDDY_AI"));
    if (!response.ok) throw new Error(`OpenAI-compatible provider stream returned HTTP ${response.status}.`);
    const parsed = parseStreamText(text, chatStreamToken);
    return { provider: "openai-compatible", model, answer: parsed.answer, usage: parsed.usage, endpointHost: endpointHost(endpoint) };
  }

  throw new Error(`AI provider "${provider}" is local or unsupported for active stream smoke.`);
}

async function smokeAI() {
  if (!shouldRun("ai")) return;
  const provider = selectedAIProvider();
  if (provider === "learnbuddy-demo" || provider === "demo" || provider === "local") {
    const message = "AI provider is local/demo; no external request was made.";
    if (productionLike) fail("ai", message, { provider });
    else warn("ai", message, { provider });
    return;
  }

  try {
    const result = await completeAI({
      system: "learnordie.app provider smoke. Reply with exactly: ok",
      user: "Return ok.",
      maxOutputTokens: 16
    });
    const streamResult = await streamAI({
      system: "learnordie.app provider stream smoke. Reply with exactly: ok",
      user: "Return ok.",
      maxOutputTokens: 16
    });
    pass("ai", "AI provider returned text and a native stream.", {
      provider: result.provider,
      model: result.model,
      endpointHost: result.endpointHost,
      usage: result.usage,
      stream: {
        provider: streamResult.provider,
        model: streamResult.model,
        endpointHost: streamResult.endpointHost,
        usage: streamResult.usage
      }
    });
  } catch (error) {
    fail("ai", error);
  }
}

async function smokeChatModeration() {
  if (!shouldRun("chat_moderation")) return;
  const provider = selectedChatModerationProvider();
  if (!["ai", "llm", "external", "provider", "learnordie", "learnordie-responses", "ctox", "ctox-responses", "openai-compatible", "http"].includes(provider)) {
    const message = "Chat moderation is not configured for provider-backed decisions.";
    if (productionLike) fail("chat_moderation", message, { provider });
    else warn("chat_moderation", message, { provider });
    return;
  }

  try {
    const result = await completeAI({
      system: "LEARNBUDDY_CHAT_QUESTION_MODERATION_V1 Return JSON only.",
      user: "Vorlesung: Gleitlagerung. Frage: Wie verändert Viskosität die Stribeck-Kurve? Antworte mit {\"status\":\"accepted\",\"reason\":\"...\",\"sourceTopic\":\"Gleitlagerung\",\"confidence\":94,\"signals\":[\"Stribeck\"]}.",
      maxOutputTokens: 120,
      responseFormat: "json_object"
    });
    const parsed = JSON.parse(result.answer);
    const status = String(parsed.status ?? "").toLowerCase();
    if (status !== "accepted" && status !== "ignored") {
      throw new Error("Chat moderation provider returned no accepted|ignored status.");
    }
    pass("chat_moderation", "Chat moderation provider returned a parseable decision.", {
      provider: result.provider,
      model: result.model,
      status,
      confidence: Number.isFinite(Number(parsed.confidence)) ? Number(parsed.confidence) : undefined
    });
  } catch (error) {
    fail("chat_moderation", error);
  }
}

function validateQuestionGeneratorPayload(answer) {
  let parsed;
  try {
    parsed = JSON.parse(answer);
  } catch {
    throw new Error("Question generator provider returned invalid JSON.");
  }

  const variants = Array.isArray(parsed?.variants) ? parsed.variants : [];
  const levels = ["4.0", "3.0", "2.0", "1.0"];
  const questionTexts = [];
  for (const level of levels) {
    const variant = variants.find((candidate) => candidate?.level === level);
    if (!variant || typeof variant.text !== "string" || !variant.text.trim()) {
      throw new Error(`Question generator provider returned no usable ${level} question.`);
    }
    questionTexts.push(variant.text.toLocaleLowerCase("de-DE").replace(/\s+/g, " ").trim());
    if (typeof variant.explanation !== "string" || !variant.explanation.trim()) {
      throw new Error(`Question generator provider returned no usable ${level} explanation.`);
    }
    if (!Array.isArray(variant.answers) || variant.answers.length !== 4) {
      throw new Error(`Question generator provider returned invalid ${level} answers.`);
    }
    if (variant.answers.some((answerOption) => typeof answerOption?.text !== "string" || !answerOption.text.trim())) {
      throw new Error(`Question generator provider returned empty ${level} answer text.`);
    }
    if (variant.answers.filter((answerOption) => answerOption?.correct === true).length !== 1) {
      throw new Error(`Question generator provider returned invalid ${level} correct answer count.`);
    }
  }
  if (new Set(questionTexts).size !== levels.length) {
    throw new Error("Question generator provider returned duplicate question texts.");
  }
  return variants;
}

async function smokeQuestionGenerator() {
  if (!shouldRun("question_generator")) return;
  const provider = selectedQuestionGenerator();
  if (!["ai", "llm", "external", "provider", "learnordie", "learnordie-responses", "ctox", "ctox-responses", "openai-compatible", "http"].includes(provider)) {
    const message = "Question generator is not configured for provider-backed material review questions.";
    if (productionLike) fail("question_generator", message, { provider });
    else warn("question_generator", message, { provider });
    return;
  }

  try {
    const result = await completeAI({
      system: "LEARNBUDDY_QUESTION_GENERATOR_SMOKE_V1 Return JSON only.",
      user: [
        "Vorlesung: Maschinenelemente I / Gleitlagerung",
        "Quelle: Hydrodynamische Gleitlagerung, Mischreibung, Stribeck-Kurve.",
        "Erzeuge JSON mit variants fuer 4.0, 3.0, 2.0 und 1.0. Jede Variante braucht text, explanation und vier answers mit genau einem correct=true."
      ].join("\n"),
      maxOutputTokens: 900,
      temperature: 0.25,
      responseFormat: "json_object"
    });
    const variants = validateQuestionGeneratorPayload(result.answer);
    pass("question_generator", "Question generator provider returned four valid review levels.", {
      provider: result.provider,
      model: result.model,
      endpointHost: result.endpointHost,
      levels: variants.map((variant) => variant.level),
      usage: result.usage
    });
  } catch (error) {
    fail("question_generator", error);
  }
}

async function smokeLecturerAssistant() {
  if (!shouldRun("lecturer_assistant")) return;
  const provider = selectedLecturerAssistantProvider();
  if (!["ai", "llm", "external", "provider", "learnordie", "learnordie-responses", "ctox", "ctox-responses", "openai-compatible", "http"].includes(provider)) {
    const message = "Lecturer assistant is not configured for provider-backed answers.";
    if (productionLike) fail("lecturer_assistant", message, { provider });
    else warn("lecturer_assistant", message, { provider });
    return;
  }

  try {
    const result = await completeAI({
      system: [
        "LEARNBUDDY_LECTURER_ASSISTANT_SMOKE_V1",
        "Du bist der foliennahe Referenten-Assistent im learnordie.app-Studio.",
        "Antworte knapp auf Deutsch und nenne keine Provider- oder Token-Details."
      ].join(" "),
      user: [
        "Vorlesungsreihe: Maschinenelemente I",
        "Vorlesung: Gleitlagerung",
        "Aktuelle Folie: Hydrodynamische Gleitlagerung",
        "Folientext: Ein tragender Schmierfilm entsteht durch Relativbewegung und einen keilförmigen Spalt.",
        "Referentenfrage: Welche WYSIWYG-nahe Erklärung würdest du als nächsten Folienpunkt empfehlen?"
      ].join("\n"),
      maxOutputTokens: 120
    });
    if (!result.answer || result.answer.length < 2) {
      throw new Error("Lecturer assistant provider returned no usable answer text.");
    }
    const toolPlanResult = await completeAI({
      system: "LEARNBUDDY_LECTURER_ASSISTANT_TOOL_PLAN_V1 Return JSON only.",
      user: [
        "Vorlesungsreihe: Maschinenelemente I",
        "Vorlesung: Gleitlagerung",
        "Aktuelle Folie: Hydrodynamische Gleitlagerung",
        "Referentenfrage: Welche nächste Toolaktion passt?",
        "Erlaubte Actions: source_note, slide_point, review_draft, evaluation_focus, learn_density.",
        "Antworte mit {\"strategy\":\"...\",\"toolPlan\":[{\"action\":\"slide_point\",\"label\":\"Folienpunkt übernehmen\",\"reason\":\"...\",\"order\":1,\"status\":\"suggested\"}]}."
      ].join("\n"),
      maxOutputTokens: 220,
      responseFormat: "json_object"
    });
    const parsedPlan = JSON.parse(toolPlanResult.answer);
    const toolPlan = Array.isArray(parsedPlan.toolPlan) ? parsedPlan.toolPlan : [];
    const allowedActions = new Set(["source_note", "slide_point", "review_draft", "evaluation_focus", "learn_density"]);
    const actions = toolPlan.map((tool) => String(tool?.action ?? ""));
    const firstAction = String(toolPlan[0]?.action ?? "");
    if (actions.length === 0 || actions.some((action) => !allowedActions.has(action))) {
      throw new Error("Lecturer assistant provider returned no valid tool plan action.");
    }
    pass("lecturer_assistant", "Lecturer assistant provider returned a WYSIWYG answer and parseable tool plan.", {
      provider: result.provider,
      model: result.model,
      endpointHost: result.endpointHost,
      usage: result.usage,
      toolPlan: {
        firstAction,
        actions,
        usage: toolPlanResult.usage
      }
    });
  } catch (error) {
    fail("lecturer_assistant", error);
  }
}

async function smokeEmbedding() {
  if (!shouldRun("embedding")) return;
  const provider = selectedEmbeddingProvider();
  if (provider !== "openai-compatible" && provider !== "http") {
    const message = "Embedding provider is local; no external embedding request was made.";
    if (productionLike) fail("embedding", message, { provider });
    else skip("embedding", message, { provider });
    return;
  }

  try {
    const endpoint = normalizeEmbeddingEndpoint(envValue("LEARNBUDDY_EMBEDDING_BASE_URL"));
    if (!endpoint) throw new Error("LEARNBUDDY_EMBEDDING_BASE_URL is missing.");
    const apiKey = envValue("LEARNBUDDY_EMBEDDING_API_KEY");
    if (productionLike && !apiKey) throw new Error("LEARNBUDDY_EMBEDDING_API_KEY is missing.");
    const model = envValue("LEARNBUDDY_EMBEDDING_MODEL") || "learnbuddy-external-embedding";
    const { response, payload } = await fetchJson(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({
        model,
        input: "Gleitlagerung Mischreibung Stribeck-Kurve",
        encoding_format: "float"
      })
    }, providerTimeoutMs("LEARNBUDDY_EMBEDDING"));
    if (!response.ok) throw new Error(`Embedding provider returned HTTP ${response.status}.`);
    const vector = payload?.data?.[0]?.embedding;
    if (!Array.isArray(vector)) throw new Error("Embedding provider returned no vector.");
    if (vector.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(`Embedding vector has ${vector.length} dimensions, expected ${EMBEDDING_DIMENSIONS}.`);
    }
    if (vector.some((value) => !Number.isFinite(Number(value)))) {
      throw new Error("Embedding vector contains non-numeric values.");
    }
    pass("embedding", "Embedding provider returned a valid vector.", {
      provider,
      model,
      dimensions: vector.length,
      endpointHost: endpointHost(endpoint)
    });
  } catch (error) {
    fail("embedding", error);
  }
}

async function smokeOCR() {
  if (!shouldRun("ocr")) return;
  const provider = selectedOCRProvider();
  if (!["http", "external", "vision", "ocr"].includes(provider)) {
    const message = "OCR provider is not configured for external scan extraction.";
    if (productionLike) fail("ocr", message, { provider });
    else skip("ocr", message, { provider });
    return;
  }

  try {
    const endpoint = normalizeOcrEndpoint(envValue("LEARNBUDDY_OCR_BASE_URL"));
    if (!endpoint) throw new Error("LEARNBUDDY_OCR_BASE_URL is missing.");
    const apiKey = envValue("LEARNBUDDY_OCR_API_KEY");
    if (productionLike && !apiKey) throw new Error("LEARNBUDDY_OCR_API_KEY is missing.");
    const model = envValue("LEARNBUDDY_OCR_MODEL") || "learnbuddy-ocr";
    const { response, payload } = await fetchJson(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
      },
      body: JSON.stringify({
        model,
        language: envValue("LEARNBUDDY_OCR_LANGUAGE") || "de",
        fileName: "provider-smoke-scan.png",
        mimeType: "image/png",
        images: [{
          name: "provider-smoke-scan.png",
          mimeType: "image/png",
          contentBase64: Buffer.from("OCR_TEXT: Gleitlagerung Schmierfilm Stribeck-Kurve", "utf8").toString("base64")
        }]
      })
    }, providerTimeoutMs("LEARNBUDDY_OCR"));
    if (!response.ok) throw new Error(`OCR provider returned HTTP ${response.status}.`);
    const text = String(payload?.text ?? payload?.output_text ?? "").trim();
    if (!text || !/Gleitlagerung|Schmierfilm|Stribeck/i.test(text)) {
      throw new Error("OCR provider returned no usable scan text.");
    }
    pass("ocr", "OCR provider returned usable scan text.", {
      provider,
      model,
      endpointHost: endpointHost(endpoint),
      characters: text.length,
      layoutRegions: [
        ...(Array.isArray(payload?.regions) ? payload.regions : []),
        ...(Array.isArray(payload?.blocks) ? payload.blocks : []),
        ...(Array.isArray(payload?.layout) ? payload.layout : []),
        ...(Array.isArray(payload?.pages)
          ? payload.pages.flatMap((page) => [
            ...(Array.isArray(page?.regions) ? page.regions : []),
            ...(Array.isArray(page?.blocks) ? page.blocks : []),
            ...(Array.isArray(page?.layout) ? page.layout : [])
          ])
          : [])
      ].length
    });
  } catch (error) {
    fail("ocr", error);
  }
}

function objectUrl(endpoint, artifactPath) {
  return `${endpoint}/objects/${artifactPath.split("/").map(encodeURIComponent).join("/")}`;
}

async function smokeStorage() {
  if (!shouldRun("storage")) return;
  const provider = selectedStorageProvider();
  if (!provider || provider === "local" || provider === "filesystem") {
    const message = "Storage provider is local; no remote object roundtrip was made.";
    if (productionLike) fail("storage", message, { provider: provider || "local" });
    else skip("storage", message, { provider: provider || "local" });
    return;
  }

  const artifactPath = `smoke/provider-smoke-${Date.now()}.txt`;
  const content = `learnbuddy provider smoke ${new Date().toISOString()}`;
  try {
    if (provider === "http" || provider === "object-http" || provider === "external") {
      const endpoint = normalizeStorageEndpoint(envValue("LEARNBUDDY_STORAGE_ENDPOINT"));
      if (!endpoint) throw new Error("LEARNBUDDY_STORAGE_ENDPOINT is missing.");
      const apiKey = envValue("LEARNBUDDY_STORAGE_API_KEY");
      const headers = {
        "content-type": "text/plain; charset=utf-8",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
      };
      const put = await fetch(objectUrl(endpoint, artifactPath), {
        method: "PUT",
        headers,
        body: content
      });
      if (!put.ok) throw new Error(`HTTP storage PUT returned HTTP ${put.status}.`);
      const get = await fetch(objectUrl(endpoint, artifactPath), {
        method: "GET",
        headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {}
      });
      if (!get.ok) throw new Error(`HTTP storage GET returned HTTP ${get.status}.`);
      const roundtrip = await get.text();
      if (roundtrip !== content) throw new Error("HTTP storage roundtrip content mismatch.");
      pass("storage", "HTTP object storage PUT/GET roundtrip succeeded.", {
        provider: "http",
        endpointHost: endpointHost(endpoint),
        bytes: content.length
      });
      return;
    }

    if (provider === "vercel" || provider === "vercel-blob" || provider === "blob") {
      const token = envValue("LEARNBUDDY_STORAGE_TOKEN") || envValue("BLOB_READ_WRITE_TOKEN");
      if (!token) throw new Error("BLOB_READ_WRITE_TOKEN or LEARNBUDDY_STORAGE_TOKEN is missing.");
      const { put, get } = await import("@vercel/blob");
      const result = await put(artifactPath, content, {
        access: envValue("LEARNBUDDY_STORAGE_ACCESS") === "public" ? "public" : "private",
        allowOverwrite: true,
        contentType: "text/plain; charset=utf-8",
        token
      });
      const stored = await get(result.pathname, {
        access: envValue("LEARNBUDDY_STORAGE_ACCESS") === "public" ? "public" : "private",
        token,
        useCache: false
      });
      if (!stored || stored.statusCode !== 200) throw new Error("Vercel Blob GET did not return status 200.");
      const roundtrip = await new Response(stored.stream).text();
      if (roundtrip !== content) throw new Error("Vercel Blob roundtrip content mismatch.");
      pass("storage", "Vercel Blob PUT/GET roundtrip succeeded.", {
        provider: "vercel-blob",
        bytes: content.length
      });
      return;
    }

    throw new Error(`Unsupported storage provider "${provider}".`);
  } catch (error) {
    fail("storage", error, { provider });
  }
}

async function smokeMail() {
  if (!shouldRun("mail")) return;
  const provider = selectedMailProvider();
  if (provider !== "resend") {
    const message = "Mail provider is local/test; no external email was sent.";
    if (productionLike) fail("mail", message, { provider });
    else skip("mail", message, { provider });
    return;
  }

  try {
    const apiKey = envValue("RESEND_API_KEY");
    const from = envValue("EMAIL_FROM");
    const to = envValue("LEARNBUDDY_PROVIDER_SMOKE_EMAIL") || envValue("LEARNBUDDY_SMOKE_EMAIL");
    if (!apiKey) throw new Error("RESEND_API_KEY is missing.");
    if (!from) throw new Error("EMAIL_FROM is missing.");
    if (!to) throw new Error("LEARNBUDDY_PROVIDER_SMOKE_EMAIL is required for active mail smoke.");
    const { Resend } = await import("resend");
    const baseUrl = normalizeOptionalHttpBaseUrl(envValue("LEARNBUDDY_RESEND_BASE_URL") || envValue("RESEND_BASE_URL"), "Resend base URL");
    const resend = new Resend(apiKey, baseUrl ? { baseUrl } : undefined);
    const result = await resend.emails.send({
      from,
      to,
      subject: "learnordie.app provider smoke",
      text: `learnordie.app provider smoke at ${new Date().toISOString()}.`,
      html: `<p>learnordie.app provider smoke at ${new Date().toISOString()}.</p>`
    });
    if (result.error) {
      throw new Error(typeof result.error.message === "string" ? result.error.message : "Resend returned an error.");
    }
    pass("mail", "Resend accepted the smoke email.", {
      provider: "resend",
      id: result.data?.id ? String(result.data.id) : undefined,
      endpointHost: baseUrl ? endpointHost(baseUrl) : "api.resend.com"
    });
  } catch (error) {
    fail("mail", error);
  }
}

async function smokeSTT() {
  if (!shouldRun("stt")) return;
  const provider = selectedSTTProvider();
  const providerBacked = ["mistral", "mistral-voxtral", "voxtral", "external", "openai-compatible", "http", "self-hosted", "self-hosted-vllm", "vllm", "vllm-realtime", "self-hosted-vllm-realtime", "openai-realtime"].includes(provider);
  const openAICompatibleStt = ["openai-compatible", "http", "self-hosted", "self-hosted-vllm", "vllm"].includes(provider);
  const realtimeStt = ["vllm-realtime", "self-hosted-vllm-realtime", "openai-realtime"].includes(provider);
  if (!providerBacked) {
    const message = "STT provider is local; no external transcription request was made.";
    if (productionLike) fail("stt", message, { provider });
    else skip("stt", message, { provider });
    return;
  }

  try {
    const apiKey = envValue("LEARNBUDDY_STT_API_KEY") || envValue("MISTRAL_API_KEY");
    if (!apiKey) throw new Error(provider === "mistral-voxtral" || provider === "mistral" || provider === "voxtral" ? "MISTRAL_API_KEY or LEARNBUDDY_STT_API_KEY is missing." : "LEARNBUDDY_STT_API_KEY is missing.");
    const sttBaseUrl = envValue("LEARNBUDDY_STT_BASE_URL");
    if ((openAICompatibleStt || realtimeStt) && !sttBaseUrl && !envValue("LEARNBUDDY_STT_REALTIME_BASE_URL")) {
      throw new Error("LEARNBUDDY_STT_BASE_URL is missing.");
    }
    const samplePath = envValue("LEARNBUDDY_STT_SMOKE_FILE");
    if (!samplePath && productionLike && !useMock) {
      throw new Error("LEARNBUDDY_STT_SMOKE_FILE is required for active production STT smoke.");
    }
    const audio = samplePath ? await readFile(samplePath) : Buffer.from("mock-audio", "utf8");
    if (realtimeStt) {
      const model = envValue("LEARNBUDDY_STT_MODEL") || "mistralai/Voxtral-Mini-4B-Realtime-2602";
      const endpoint = normalizeRealtimeSttEndpoint(envValue("LEARNBUDDY_STT_REALTIME_BASE_URL") || sttBaseUrl);
      if (!endpoint) throw new Error("LEARNBUDDY_STT_BASE_URL is missing.");
      const text = await realtimeSttRoundtrip(endpoint, apiKey, model, audio, providerTimeoutMs("LEARNBUDDY_STT"));
      if (!text) throw new Error("Realtime STT provider returned no transcript text.");
      pass("stt", "Realtime STT provider returned transcript text over WebSocket.", {
        provider: "self-hosted-vllm-realtime",
        model,
        endpointHost: endpointHost(endpoint),
        audioBytes: audio.byteLength,
        transport: "websocket"
      });
      return;
    }

    const endpoint = normalizeSttEndpoint(openAICompatibleStt ? sttBaseUrl : sttBaseUrl || envValue("MISTRAL_STT_BASE_URL"));
    const formData = new FormData();
    formData.set("model", envValue("LEARNBUDDY_STT_MODEL") || envValue("MISTRAL_STT_MODEL") || "voxtral-mini-latest");
    formData.set("language", envValue("LEARNBUDDY_STT_LANGUAGE") || "de");
    formData.set("diarize", "false");
    formData.append("context_bias", "Gleitlagerung");
    formData.append("file", new Blob([audio], { type: "audio/webm" }), samplePath ? samplePath.split("/").pop() : "provider-smoke.webm");
    const { response, payload } = await fetchJson(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`
      },
      body: formData
    }, providerTimeoutMs("LEARNBUDDY_STT"));
    if (!response.ok) throw new Error(`STT provider returned HTTP ${response.status}.`);
    const text = typeof payload?.text === "string"
      ? payload.text.trim()
      : Array.isArray(payload?.segments)
        ? payload.segments.map((segment) => segment?.text ?? "").join(" ").trim()
        : "";
    if (!text) throw new Error("STT provider returned no transcript text.");
    pass("stt", "STT provider returned transcript text.", {
      provider: provider === "self-hosted-vllm" || provider === "vllm" ? "self-hosted-vllm" : openAICompatibleStt ? "openai-compatible" : "mistral-voxtral",
      model: envValue("LEARNBUDDY_STT_MODEL") || envValue("MISTRAL_STT_MODEL") || "voxtral-mini-latest",
      endpointHost: endpointHost(endpoint),
      audioBytes: audio.byteLength
    });
  } catch (error) {
    fail("stt", error);
  }
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("error", reject);
    request.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

function writeSseResponse(response, events) {
  response.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store"
  });
  for (const event of events) {
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  response.write("data: [DONE]\n\n");
  response.end();
}

function streamChunks(content, size = 12) {
  return content.match(new RegExp(`.{1,${size}}(?:\\s|$)`, "g"))?.map((chunk) => chunk.trim()).filter(Boolean) ?? [content];
}

function websocketAcceptKey(key) {
  return createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
}

function encodeWebSocketTextFrame(text) {
  const payload = Buffer.from(text, "utf8");
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  }
  if (payload.length <= 0xffff) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(payload.length), 2);
  return Buffer.concat([header, payload]);
}

function decodeWebSocketFrames(input) {
  const messages = [];
  let offset = 0;

  while (offset + 2 <= input.length) {
    const first = input[offset];
    const second = input[offset + 1];
    const opcode = first & 0x0f;
    const masked = Boolean(second & 0x80);
    let length = second & 0x7f;
    let headerLength = 2;

    if (length === 126) {
      if (offset + 4 > input.length) break;
      length = input.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (length === 127) {
      if (offset + 10 > input.length) break;
      const longLength = input.readBigUInt64BE(offset + 2);
      if (longLength > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("WebSocket mock frame is too large.");
      length = Number(longLength);
      headerLength = 10;
    }

    const maskLength = masked ? 4 : 0;
    const frameEnd = offset + headerLength + maskLength + length;
    if (frameEnd > input.length) break;

    let payload = input.subarray(offset + headerLength + maskLength, frameEnd);
    if (masked) {
      const mask = input.subarray(offset + headerLength, offset + headerLength + 4);
      payload = Buffer.from(payload.map((byte, index) => byte ^ mask[index % 4]));
    }

    if (opcode === 0x1) messages.push(payload.toString("utf8"));
    if (opcode === 0x8) messages.push("__close__");
    offset = frameEnd;
  }

  return { messages, rest: input.subarray(offset) };
}

function sendWebSocketJson(socket, payload) {
  socket.write(encodeWebSocketTextFrame(JSON.stringify(payload)));
}

function handleMockRealtimeUpgrade(request, socket) {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
  if (url.pathname !== "/v1/realtime") {
    socket.destroy();
    return;
  }
  const key = request.headers["sec-websocket-key"];
  if (typeof key !== "string" || !key.trim()) {
    socket.destroy();
    return;
  }

  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${websocketAcceptKey(key)}`,
    "\r\n"
  ].join("\r\n"));
  sendWebSocketJson(socket, { type: "session.created" });

  let buffered = Buffer.alloc(0);
  let sawAudio = false;
  socket.on("data", (chunk) => {
    try {
      const decoded = decodeWebSocketFrames(Buffer.concat([buffered, chunk]));
      buffered = decoded.rest;
      for (const message of decoded.messages) {
        if (message === "__close__") {
          socket.end();
          continue;
        }
        const payload = JSON.parse(message);
        if (payload.type === "input_audio_buffer.append" && typeof payload.audio === "string" && payload.audio.length > 0) {
          sawAudio = true;
        }
        if (payload.type === "input_audio_buffer.commit") {
          if (!sawAudio) {
            sendWebSocketJson(socket, { type: "error", error: { message: "No audio received." } });
            socket.end();
            return;
          }
          const text = "Mock Realtime Voxtral Transkript zur Gleitlagerung.";
          sendWebSocketJson(socket, { type: "transcription.delta", delta: text });
          sendWebSocketJson(socket, { type: "transcription.completed", text });
          socket.end();
          return;
        }
      }
    } catch {
      socket.destroy();
    }
  });
}

function mockAIProviderMode() {
  const selected = envValue("LEARNBUDDY_AI_PROVIDER").toLowerCase();
  if (isResponsesProxyProvider(selected)) return responsesProxyProviderName(selected);
  return "openai-compatible";
}

function mockAIResponseContent(prompt) {
  if (prompt.includes("LEARNBUDDY_LECTURER_ASSISTANT_SMOKE_V1")) {
    return "Mock-Erklärung: Der keilförmige Spalt erzeugt durch Relativbewegung den tragenden Schmierfilm; als nächster Folienpunkt sollte die Startphase zur Mischreibung abgegrenzt werden.";
  }

  if (prompt.includes("LEARNBUDDY_CHAT_QUESTION_MODERATION_V1")) {
    return JSON.stringify({
      status: "accepted",
      reason: "Fachlicher Bezug zur Gleitlagerung erkannt.",
      sourceTopic: "Gleitlagerung",
      confidence: 94,
      signals: ["Stribeck"]
    });
  }

  if (prompt.includes("LEARNBUDDY_QUESTION_GENERATOR_SMOKE_V1")) {
    return JSON.stringify({
      variants: [
        {
          level: "4.0",
          text: "Welcher Begriff beschreibt den tragenden Film im hydrodynamischen Gleitlager?",
          answers: [
            { text: "Schmierfilm", correct: true },
            { text: "Festkörperkontakt", correct: false },
            { text: "Reibkorrosion", correct: false },
            { text: "Passfeder", correct: false }
          ],
          explanation: "Der tragende Schmierfilm trennt Welle und Lager."
        },
        {
          level: "3.0",
          text: "Welche bekannte Bedingung begünstigt den Aufbau des Schmierfilms?",
          answers: [
            { text: "Relativbewegung und keilförmiger Spalt", correct: true },
            { text: "Stillstand ohne Schmierstoff", correct: false },
            { text: "Maximaler Festkörperkontakt", correct: false },
            { text: "Beliebig kleines Lagerspiel", correct: false }
          ],
          explanation: "Die Relativbewegung transportiert Schmierstoff in den Keilspalt."
        },
        {
          level: "2.0",
          text: "Warum ist Mischreibung beim Anlauf kritisch?",
          answers: [
            { text: "Schmierfilm und Festkörperkontakt treten gleichzeitig auf.", correct: true },
            { text: "Die Welle schwimmt bereits vollständig auf.", correct: false },
            { text: "Die Viskosität wird immer null.", correct: false },
            { text: "Das Lager benötigt keinen Schmierstoff.", correct: false }
          ],
          explanation: "In Mischreibung können Lastspitzen und Verschleiß entstehen."
        },
        {
          level: "1.0",
          text: "Eine schwer belastete Welle läuft langsam an. Welche Maßnahme adressiert das eigentliche Gleitlagerproblem?",
          answers: [
            { text: "Startphase entlasten oder zusätzliche Schmierfilmversorgung vorsehen.", correct: true },
            { text: "Nur die Enddrehzahl erhöhen.", correct: false },
            { text: "Den Schmierstoff entfernen.", correct: false },
            { text: "Das Lagerspiel beliebig verkleinern.", correct: false }
          ],
          explanation: "Die Maßnahme muss die kritische Übergangsphase bis zum tragenden Film abdecken."
        }
      ]
    });
  }

  if (prompt.includes("LEARNBUDDY_LECTURER_ASSISTANT_TOOL_PLAN_V1")) {
    return JSON.stringify({
      strategy: "Lernziel schärfen und Review-Draft erzeugen",
      toolPlan: [
        {
          action: "slide_point",
          label: "Folienpunkt übernehmen",
          reason: "Die Kernaussage soll direkt auf der sichtbaren Folie landen.",
          order: 1,
          status: "suggested"
        },
        {
          action: "review_draft",
          label: "Fragenentwurf anlegen",
          reason: "Aus dem Folienpunkt entsteht danach eine 4-Niveau-Fragefamilie.",
          order: 2,
          status: "suggested",
          prerequisite: "Folienpunkt übernehmen"
        },
        {
          action: "evaluation_focus",
          label: "Evaluation fokussieren",
          reason: "Die nächste Evaluation soll prüfen, ob der Unterschied zwischen Mischreibung und tragendem Film verstanden wurde.",
          order: 3,
          status: "suggested"
        }
      ]
    });
  }

  return "ok";
}

async function startMockServer() {
  const host = "127.0.0.1";
  const configuredPort = args.get("mock-port") || process.env.LEARNBUDDY_PROVIDER_SMOKE_MOCK_PORT || "0";
  const port = Number(configuredPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("Provider smoke mock port must be an integer between 0 and 65535.");
  }
  const objects = new Map();
  mockServer = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);
    const body = await readBody(request);

    if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
      const payload = JSON.parse(body.toString("utf8") || "{}");
      const prompt = JSON.stringify(payload.messages ?? []);
      const content = mockAIResponseContent(prompt);
	      if (payload.stream === true) {
	        writeSseResponse(response, [
	          ...streamChunks(content).map((chunk) => ({ choices: [{ delta: { content: `${chunk} ` } }] })),
	          { choices: [], usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 } }
	        ]);
	        return;
	      }
	      response.writeHead(200, { "content-type": "application/json" });
	      response.end(JSON.stringify({
	        choices: [{ message: { content } }],
        usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/responses") {
      const payload = JSON.parse(body.toString("utf8") || "{}");
      const prompt = JSON.stringify(payload.input ?? "");
      const content = mockAIResponseContent(prompt);
      if (payload.stream === true) {
        writeSseResponse(response, [
          ...streamChunks(content).map((chunk) => ({ type: "response.output_text.delta", delta: `${chunk} ` })),
          { type: "response.completed", response: { usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15 } } }
        ]);
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        output_text: content,
        usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15 }
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/embeddings") {
      const embedding = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => (index === 0 ? 1 : 0));
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ embedding }] }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/ocr") {
      const payload = JSON.parse(body.toString("utf8") || "{}");
      const images = Array.isArray(payload.images) ? payload.images : [];
      const decoded = images
        .map((image) => {
          if (typeof image?.contentBase64 !== "string") return "";
          try {
            return Buffer.from(image.contentBase64, "base64").toString("utf8");
          } catch {
            return "";
          }
        })
        .join("\n");
      const markerMatch = decoded.match(/OCR_TEXT:\s*([\s\S]+)/);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        text: markerMatch?.[1]?.trim() || "",
        confidence: markerMatch ? 0.94 : 0,
        model: "mock-ocr",
        regions: markerMatch
          ? [
            {
              page: 1,
              label: "Scanbereich",
              text: "Gleitlagerung",
              bbox: { x: 32, y: 48, width: 420, height: 160 },
              confidence: 0.91
            }
          ]
          : []
      }));
      return;
    }

    if (url.pathname.startsWith("/objects/")) {
      const key = decodeURIComponent(url.pathname.slice("/objects/".length));
      if (request.method === "PUT") {
        objects.set(key, body);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
        return;
      }
      if (request.method === "GET" && objects.has(key)) {
        response.writeHead(200, { "content-type": "application/octet-stream" });
        response.end(objects.get(key));
        return;
      }
    }

    if (request.method === "POST" && url.pathname === "/v1/audio/transcriptions") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        text: "Mock Voxtral Transkript zur Gleitlagerung.",
        language: "de"
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/emails") {
      const payload = JSON.parse(body.toString("utf8") || "{}");
      if (!payload.from || !payload.to || !payload.subject || (!payload.text && !payload.html)) {
        response.writeHead(422, { "content-type": "application/json" });
        response.end(JSON.stringify({
          name: "validation_error",
          message: "Missing required email fields."
        }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ id: "email_mock_provider_smoke" }));
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "Not found" } }));
  });
  mockServer.on("upgrade", handleMockRealtimeUpgrade);

  await new Promise((resolve, reject) => {
    mockServer.once("error", reject);
    mockServer.listen(port, host, resolve);
  });

  const address = mockServer.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const baseUrl = `http://${host}:${actualPort}`;
  const aiProvider = mockAIProviderMode();
  process.env.LEARNBUDDY_AI_PROVIDER = aiProvider;
  process.env.LEARNBUDDY_AI_BASE_URL = baseUrl;
  process.env.LEARNBUDDY_AI_API_KEY = "provider-smoke-mock-token";
  process.env.LEARNBUDDY_LLM_PROXY_BASE_URL = baseUrl;
  process.env.LEARNBUDDY_LLM_PROXY_API_KEY = "provider-smoke-mock-token";
  process.env.LEARNBUDDY_AI_MODEL = "mock-provider-smoke";
  process.env.LEARNBUDDY_LECTURER_ASSISTANT_PROVIDER = "ai";
  process.env.LEARNBUDDY_CHAT_MODERATION_PROVIDER = "ai";
  process.env.LEARNBUDDY_QUESTION_GENERATOR = "ai";
  process.env.LEARNBUDDY_EMBEDDING_PROVIDER = "openai-compatible";
  process.env.LEARNBUDDY_EMBEDDING_BASE_URL = baseUrl;
  process.env.LEARNBUDDY_EMBEDDING_API_KEY = "provider-smoke-mock-token";
  process.env.LEARNBUDDY_EMBEDDING_MODEL = "mock-embedding";
  process.env.LEARNBUDDY_OCR_PROVIDER = "http";
  process.env.LEARNBUDDY_OCR_BASE_URL = baseUrl;
  process.env.LEARNBUDDY_OCR_API_KEY = "provider-smoke-mock-token";
  process.env.LEARNBUDDY_OCR_MODEL = "mock-ocr";
  process.env.LEARNBUDDY_STORAGE_PROVIDER = "http";
  process.env.LEARNBUDDY_STORAGE_ENDPOINT = baseUrl;
  process.env.LEARNBUDDY_STORAGE_API_KEY = "provider-smoke-mock-token";
  process.env.LEARNBUDDY_MAIL_PROVIDER = "resend";
  process.env.RESEND_API_KEY = "provider-smoke-mock-token";
  process.env.EMAIL_FROM = "learnordie.app <noreply@example.test>";
  process.env.LEARNBUDDY_PROVIDER_SMOKE_EMAIL = "provider-smoke@example.test";
  process.env.LEARNBUDDY_RESEND_BASE_URL = baseUrl;
  if (!envValue("LEARNBUDDY_STT_PROVIDER")) {
    process.env.LEARNBUDDY_STT_PROVIDER = "mistral-voxtral";
  }
  process.env.LEARNBUDDY_STT_BASE_URL = baseUrl;
  process.env.MISTRAL_API_KEY = "provider-smoke-mock-token";
  process.env.LEARNBUDDY_STT_API_KEY = "provider-smoke-mock-token";
  process.env.LEARNBUDDY_STT_MODEL = "mock-voxtral";
}

async function main() {
  const unknownChecks = unknownOnlyChecks();
  if (unknownChecks.length > 0) {
    fail("selection", "Unknown provider smoke check selected.", {
      unknown: unknownChecks,
      allowed: ALL_CHECKS
    });
    const result = {
      ok: false,
      command: "provider-smoke",
      profile,
      mock: useMock,
      checks,
      blockers: checks
        .filter((check) => check.status === "fail")
        .map((check) => ({
          id: check.id,
          status: check.status,
          message: check.message,
          details: check.details
        })),
      summary: {
        total: checks.length,
        passed: 0,
        skipped: 0,
        warnings: 0,
        failed: checks.length
      }
    };
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 1;
    return;
  }

  if (useMock) await startMockServer();

  for (const id of ALL_CHECKS) {
    if (!shouldRun(id)) {
      skip(id, "Skipped by --only filter.");
    }
  }

  await smokeAI();
  await smokeLecturerAssistant();
  await smokeChatModeration();
  await smokeQuestionGenerator();
  await smokeEmbedding();
  await smokeOCR();
  await smokeStorage();
  await smokeMail();
  await smokeSTT();

  mockServer?.close();

  const failed = checks.filter((check) => check.status === "fail");
  const warnings = checks.filter((check) => check.status === "warn");
  const result = {
    ok: failed.length === 0,
    command: "provider-smoke",
    profile,
    mock: useMock,
    checks,
    blockers: failed.map((check) => ({
      id: check.id,
      status: check.status,
      message: check.message,
      details: check.details
    })),
    summary: {
      total: checks.length,
      passed: checks.filter((check) => check.status === "pass").length,
      skipped: checks.filter((check) => check.status === "skip").length,
      warnings: warnings.length,
      failed: failed.length
    }
  };
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  mockServer?.close();
  console.error(JSON.stringify({
    ok: false,
    command: "provider-smoke",
    profile,
    blockers: [
      {
        id: "provider_smoke",
        status: "fail",
        message: sanitize(error)
      }
    ],
    error: sanitize(error)
  }, null, 2));
  process.exitCode = 1;
});
