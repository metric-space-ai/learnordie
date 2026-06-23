import { assertDeploymentFetchEndpoint } from "@/server/providers/endpoint-policy";

export type TranscriptStatus = "idle" | "listening" | "error";

export type TranscribeAudioInput = {
  audio: ArrayBuffer;
  mimeType: string;
  lectureTitle: string;
  language?: string;
  slideTopic?: string;
};

export type TranscribeAudioResult = {
  provider: string;
  text: string;
  confidence: number;
  audioBytes: number;
  mimeType: string;
};

export interface STTProvider {
  readonly name: string;
  getInitialStatus(): TranscriptStatus;
  transcribeAudio(input: TranscribeAudioInput): Promise<TranscribeAudioResult>;
}

class VoxtralAdapterPlaceholder implements STTProvider {
  readonly name = "voxtral-realtime";

  getInitialStatus(): TranscriptStatus {
    return "idle";
  }

  async transcribeAudio(input: TranscribeAudioInput): Promise<TranscribeAudioResult> {
    const topic = `${input.slideTopic ?? ""} ${input.lectureTitle}`.toLowerCase();
    const text = topic.includes("stribeck")
      ? "Die Stribeck-Kurve zeigt, wie Reibung von Drehzahl, Viskosität und Last abhängt."
      : "Mischreibung ist beim Anlauf kritisch, weil der Schmierfilm noch nicht voll trägt und Festkörperkontakt auftreten kann.";

    return {
      provider: this.name,
      text,
      confidence: input.audio.byteLength > 0 ? 0.82 : 0.42,
      audioBytes: input.audio.byteLength,
      mimeType: input.mimeType
    };
  }
}

type MistralTranscriptionResponse = {
  text?: unknown;
  language?: unknown;
  duration?: unknown;
  segments?: Array<{
    text?: unknown;
  }>;
  error?: {
    message?: unknown;
  };
};

type RealtimeEventPayload = {
  type?: unknown;
  delta?: unknown;
  text?: unknown;
  transcript?: unknown;
  error?: {
    message?: unknown;
  };
  response?: unknown;
  item?: unknown;
};

function envValue(name: string) {
  return (process.env[name] ?? "").trim();
}

function isPlaceholderSecret(value: string) {
  const lower = value.trim().toLowerCase();
  return !lower || lower.includes("replace") || lower.includes("placeholder") || lower.includes("changeme");
}

function normalizeTranscriptionEndpoint(value: string, envName = "LEARNBUDDY_STT_BASE_URL") {
  const configured = value.trim().replace(/\/+$/, "");
  const base = configured || "https://api.mistral.ai";
  const endpoint = base.endsWith("/audio/transcriptions")
    ? base
    : base.endsWith("/v1")
      ? `${base}/audio/transcriptions`
      : `${base}/v1/audio/transcriptions`;
  assertDeploymentFetchEndpoint(endpoint, envName);
  return endpoint;
}

function normalizeRealtimeEndpoint(value: string, envName = "LEARNBUDDY_STT_REALTIME_BASE_URL/LEARNBUDDY_STT_BASE_URL") {
  const configured = value.trim().replace(/\/+$/, "");
  if (!configured) throw new Error("LEARNBUDDY_STT_BASE_URL is required for realtime STT.");
  const parsed = new URL(configured);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:" && parsed.protocol !== "ws:" && parsed.protocol !== "wss:") {
    throw new Error(`${envName} must be HTTP(S) or WS(S).`);
  }

  const basePath = parsed.pathname.replace(/\/+$/, "");
  parsed.pathname = basePath.endsWith("/realtime")
    ? basePath
    : basePath.endsWith("/v1")
      ? `${basePath}/realtime`
      : `${basePath}/v1/realtime`;
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : parsed.protocol === "http:" ? "ws:" : parsed.protocol;
  parsed.search = "";
  const endpoint = parsed.toString();
  assertDeploymentFetchEndpoint(endpoint, envName);
  return endpoint;
}

function sttTimeoutMs() {
  const configured = Number(process.env.LEARNBUDDY_STT_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? Math.min(60_000, Math.round(configured)) : 20_000;
}

function sttLanguage(input: TranscribeAudioInput) {
  const configured = envValue("LEARNBUDDY_STT_LANGUAGE") || input.language || "de";
  return configured.split("-")[0]?.toLowerCase() || "de";
}

function sttContextBias(input: TranscribeAudioInput) {
  const configured = envValue("LEARNBUDDY_STT_CONTEXT_BIAS")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  const base = [
    input.lectureTitle,
    input.slideTopic,
    "Gleitlagerung",
    "Mischreibung",
    "Stribeck-Kurve",
    "Sommerfeldzahl",
    "Schmierfilm",
    "Festkörperkontakt"
  ].filter((item): item is string => Boolean(item?.trim()));

  return Array.from(new Set([...configured, ...base])).slice(0, 20);
}

function normalizeTranscriptionText(payload: MistralTranscriptionResponse | null) {
  if (typeof payload?.text === "string" && payload.text.trim()) {
    return payload.text.trim();
  }

  const segmentText = payload?.segments
    ?.map((segment) => (typeof segment.text === "string" ? segment.text.trim() : ""))
    .filter(Boolean)
    .join(" ")
    .trim();
  if (segmentText) return segmentText;

  throw new Error("STT provider returned no transcript text.");
}

function realtimeDeltaText(payload: RealtimeEventPayload) {
  const type = typeof payload.type === "string" ? payload.type : "";
  if (!type.toLowerCase().includes("transcri") && !type.toLowerCase().includes("audio")) return "";
  if (typeof payload.delta === "string" && payload.delta.trim()) return payload.delta;
  if (typeof payload.text === "string" && payload.text.trim()) return payload.text;
  return "";
}

function nestedTranscriptText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  if (Array.isArray(value)) {
    return value.map(nestedTranscriptText).filter(Boolean).join(" ").trim();
  }
  const record = value as Record<string, unknown>;
  for (const key of ["transcript", "text", "output_text"]) {
    if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
  }
  return Object.values(record).map(nestedTranscriptText).filter(Boolean).join(" ").trim();
}

function realtimeFinalText(payload: RealtimeEventPayload) {
  const type = typeof payload.type === "string" ? payload.type.toLowerCase() : "";
  if (!type.includes("done") && !type.includes("completed")) return "";
  return nestedTranscriptText(payload) || nestedTranscriptText(payload.response) || nestedTranscriptText(payload.item);
}

function parseRealtimeEvent(event: MessageEvent) {
  const raw = typeof event.data === "string" ? event.data : "";
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw) as RealtimeEventPayload;
  } catch {
    return null;
  }
}

function isRealtimeCompatibleAudio(input: TranscribeAudioInput) {
  const mime = (input.mimeType || "").toLowerCase();
  return mime.includes("pcm") || mime.includes("wav") || mime === "application/octet-stream";
}

function arrayBufferToBase64(input: ArrayBuffer) {
  return Buffer.from(input).toString("base64");
}

function audioUploadFilename(mimeType?: string) {
  const normalized = (mimeType ?? "").toLowerCase();
  if (normalized.includes("wav")) return "lecture-audio.wav";
  if (normalized.includes("webm")) return "lecture-audio.webm";
  if (normalized.includes("ogg")) return "lecture-audio.ogg";
  if (normalized.includes("mpeg") || normalized.includes("mp3")) return "lecture-audio.mp3";
  return "lecture-audio.bin";
}

class MistralVoxtralSTTProvider implements STTProvider {
  readonly name: string;
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(input: { name?: string; endpoint: string; apiKey: string; model: string }) {
    this.name = input.name ?? "mistral-voxtral";
    this.endpoint = input.endpoint;
    this.apiKey = input.apiKey;
    this.model = input.model;
  }

  getInitialStatus(): TranscriptStatus {
    return "idle";
  }

  async transcribeAudio(input: TranscribeAudioInput): Promise<TranscribeAudioResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), sttTimeoutMs());
    const formData = new FormData();
    formData.set("model", this.model);
    formData.set("language", sttLanguage(input));
    formData.set("diarize", envValue("LEARNBUDDY_STT_DIARIZE") === "1" ? "true" : "false");
    for (const term of sttContextBias(input)) {
      formData.append("context_bias", term);
    }
    formData.append(
      "file",
      new Blob([input.audio], { type: input.mimeType || "application/octet-stream" }),
      audioUploadFilename(input.mimeType)
    );

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`
        },
        body: formData,
        signal: controller.signal
      });
      const payload = await response.json().catch(() => null) as MistralTranscriptionResponse | null;
      if (!response.ok) {
        const message = typeof payload?.error?.message === "string" ? payload.error.message : `HTTP ${response.status}`;
        throw new Error(`STT provider request failed: ${message}`);
      }

      return {
        provider: this.name,
        text: normalizeTranscriptionText(payload),
        confidence: 0.9,
        audioBytes: input.audio.byteLength,
        mimeType: input.mimeType
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("STT provider request timed out.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

class VllmRealtimeSTTProvider implements STTProvider {
  readonly name = "self-hosted-vllm-realtime";
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(input: { endpoint: string; apiKey: string; model: string }) {
    this.endpoint = input.endpoint;
    this.apiKey = input.apiKey;
    this.model = input.model;
  }

  getInitialStatus(): TranscriptStatus {
    return "idle";
  }

  async transcribeAudio(input: TranscribeAudioInput): Promise<TranscribeAudioResult> {
    if (!isRealtimeCompatibleAudio(input)) {
      throw new Error("vLLM realtime STT requires PCM16 or WAV audio; use self-hosted-vllm for MediaRecorder/WebM transcription.");
    }

    const transcript = await this.transcribeViaRealtimeSocket(input.audio);
    return {
      provider: this.name,
      text: transcript,
      confidence: 0.88,
      audioBytes: input.audio.byteLength,
      mimeType: input.mimeType
    };
  }

  private transcribeViaRealtimeSocket(audio: ArrayBuffer) {
    const timeoutMs = sttTimeoutMs();
    type NodeWebSocketCtor = new (url: string, options?: { headers?: Record<string, string> }) => WebSocket;
    const NodeWebSocket = WebSocket as unknown as NodeWebSocketCtor;

    return new Promise<string>((resolve, reject) => {
      const chunks: string[] = [];
      let settled = false;
      const ws = new NodeWebSocket(this.endpoint, {
        headers: {
          authorization: `Bearer ${this.apiKey}`
        }
      });

      const settle = (error?: Error, text?: string) => {
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

      const timeout = setTimeout(() => settle(new Error("STT provider realtime request timed out.")), timeoutMs);

      ws.addEventListener("open", () => {
        ws.send(JSON.stringify({ type: "session.update", model: this.model }));
        ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: arrayBufferToBase64(audio) }));
        ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
      });

      ws.addEventListener("message", (event) => {
        const payload = parseRealtimeEvent(event);
        if (!payload) return;
        const providerError = typeof payload.error?.message === "string" ? payload.error.message : "";
        if (providerError) {
          settle(new Error(`STT provider realtime request failed: ${providerError}`));
          return;
        }
        const delta = realtimeDeltaText(payload);
        if (delta) chunks.push(delta);
        const finalText = realtimeFinalText(payload);
        if (finalText) {
          settle(undefined, finalText);
          return;
        }
        const type = typeof payload.type === "string" ? payload.type.toLowerCase() : "";
        if ((type.includes("done") || type.includes("completed")) && chunks.length > 0) {
          settle(undefined, chunks.join(" "));
        }
      });

      ws.addEventListener("error", () => {
        settle(new Error("STT provider realtime request failed."));
      });

      ws.addEventListener("close", () => {
        if (chunks.length > 0) settle(undefined, chunks.join(" "));
        else settle(new Error("STT provider realtime socket closed without transcript text."));
      });
    }).then((text) => {
      if (!text.trim()) throw new Error("STT provider returned no transcript text.");
      return text.trim();
    });
  }
}

export function getSTTProvider(): STTProvider {
  const selected = envValue("LEARNBUDDY_STT_PROVIDER").toLowerCase();
  const mistralApiKey = envValue("MISTRAL_API_KEY");
  const genericApiKey = envValue("LEARNBUDDY_STT_API_KEY");
  const wantsVllmRealtime = selected === "vllm-realtime"
    || selected === "self-hosted-vllm-realtime"
    || selected === "openai-realtime";
  const wantsMistral = selected === "mistral"
    || selected === "mistral-voxtral"
    || selected === "voxtral"
    || selected === "external"
    || (!selected && !isPlaceholderSecret(mistralApiKey));
  const wantsOpenAICompatible = selected === "openai-compatible"
    || selected === "http"
    || selected === "self-hosted"
    || selected === "self-hosted-vllm"
    || selected === "vllm"
    || (!selected && !isPlaceholderSecret(genericApiKey));

  if (wantsVllmRealtime) {
    const apiKey = genericApiKey || mistralApiKey;
    if (isPlaceholderSecret(apiKey)) {
      throw new Error("LEARNBUDDY_STT_API_KEY is required for LEARNBUDDY_STT_PROVIDER=self-hosted-vllm-realtime.");
    }
    const endpointBase = envValue("LEARNBUDDY_STT_REALTIME_BASE_URL") || envValue("LEARNBUDDY_STT_BASE_URL");
    if (!endpointBase) {
      throw new Error("LEARNBUDDY_STT_BASE_URL is required for LEARNBUDDY_STT_PROVIDER=self-hosted-vllm-realtime.");
    }

    return new VllmRealtimeSTTProvider({
      endpoint: normalizeRealtimeEndpoint(endpointBase),
      apiKey,
      model: envValue("LEARNBUDDY_STT_MODEL") || "mistralai/Voxtral-Mini-4B-Realtime-2602"
    });
  }

  if (wantsMistral) {
    const apiKey = mistralApiKey || genericApiKey;
    if (isPlaceholderSecret(apiKey)) {
      throw new Error("MISTRAL_API_KEY or LEARNBUDDY_STT_API_KEY is required for LEARNBUDDY_STT_PROVIDER=mistral-voxtral.");
    }

    return new MistralVoxtralSTTProvider({
      endpoint: normalizeTranscriptionEndpoint(envValue("LEARNBUDDY_STT_BASE_URL") || envValue("MISTRAL_STT_BASE_URL"), "LEARNBUDDY_STT_BASE_URL/MISTRAL_STT_BASE_URL"),
      apiKey,
      model: envValue("LEARNBUDDY_STT_MODEL") || envValue("MISTRAL_STT_MODEL") || "voxtral-mini-latest"
    });
  }

  if (wantsOpenAICompatible) {
    const apiKey = genericApiKey || mistralApiKey;
    if (isPlaceholderSecret(apiKey)) {
      throw new Error("LEARNBUDDY_STT_API_KEY is required for LEARNBUDDY_STT_PROVIDER=openai-compatible.");
    }
    const endpointBase = envValue("LEARNBUDDY_STT_BASE_URL");
    if (!endpointBase) {
      throw new Error("LEARNBUDDY_STT_BASE_URL is required for LEARNBUDDY_STT_PROVIDER=openai-compatible.");
    }

    return new MistralVoxtralSTTProvider({
      name: selected === "self-hosted-vllm" || selected === "vllm" ? "self-hosted-vllm" : "openai-compatible-stt",
      endpoint: normalizeTranscriptionEndpoint(endpointBase, "LEARNBUDDY_STT_BASE_URL"),
      apiKey,
      model: envValue("LEARNBUDDY_STT_MODEL") || "voxtral-mini-latest"
    });
  }

  return new VoxtralAdapterPlaceholder();
}
