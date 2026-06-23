import { assertDeploymentFetchEndpoint } from "@/server/providers/endpoint-policy";

export type OCRImageInput = {
  name: string;
  mimeType: string;
  bytes: Buffer;
  page?: number;
  placement?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export type OCRProviderResult = {
  text: string;
  confidence?: number;
  model?: string;
  layout?: OCRLayoutRegion[];
};

export type OCRLayoutRegion = {
  page?: number;
  label?: string;
  text?: string;
  confidence?: number;
  bbox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export interface OCRProvider {
  readonly name: string;
  extractText(input: {
    fileName: string;
    mimeType: string;
    language?: string;
    images: OCRImageInput[];
  }): Promise<OCRProviderResult>;
}

type HTTPOCRResponse = {
  text?: unknown;
  output_text?: unknown;
  confidence?: unknown;
  model?: unknown;
  layout?: unknown;
  regions?: unknown;
  blocks?: unknown;
  pages?: Array<{ text?: unknown; confidence?: unknown; regions?: unknown; blocks?: unknown; layout?: unknown }>;
  results?: Array<{ text?: unknown; confidence?: unknown; regions?: unknown; blocks?: unknown; layout?: unknown }>;
  error?: { message?: unknown };
};

type OpenAICompatibleVisionResponse = {
  choices?: Array<{
    message?: {
      content?: unknown;
    };
  }>;
  error?: { message?: unknown };
};

function envValue(name: string) {
  return (process.env[name] ?? "").trim();
}

function ocrTimeoutMs() {
  const configured = Number(envValue("LEARNBUDDY_OCR_TIMEOUT_MS"));
  return Number.isFinite(configured) && configured > 0 ? Math.min(60_000, Math.round(configured)) : 20_000;
}

function normalizeOCRBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  const endpoint = trimmed.endsWith("/ocr") ? trimmed : `${trimmed}/v1/ocr`;
  assertDeploymentFetchEndpoint(endpoint, "LEARNBUDDY_OCR_BASE_URL");
  return endpoint;
}

function normalizeOpenAICompatibleVisionBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  const endpoint = trimmed.endsWith("/chat/completions")
    ? trimmed
    : trimmed.endsWith("/v1")
      ? `${trimmed}/chat/completions`
      : `${trimmed}/v1/chat/completions`;
  assertDeploymentFetchEndpoint(endpoint, "LEARNBUDDY_OCR_BASE_URL");
  return endpoint;
}

function normalizedTextFromPayload(payload: HTTPOCRResponse | null) {
  const directText = typeof payload?.text === "string"
    ? payload.text
    : typeof payload?.output_text === "string"
      ? payload.output_text
      : "";
  const nestedText = [
    ...(payload?.pages ?? []),
    ...(payload?.results ?? [])
  ]
    .map((item) => (typeof item.text === "string" ? item.text : ""))
    .filter(Boolean)
    .join("\n");
  return [directText, nestedText]
    .map((item) => item.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}

function normalizedConfidence(payload: HTTPOCRResponse | null) {
  const direct = Number(payload?.confidence);
  if (Number.isFinite(direct) && direct >= 0) return direct;
  const nested = [...(payload?.pages ?? []), ...(payload?.results ?? [])]
    .map((item) => Number(item.confidence))
    .filter((value) => Number.isFinite(value) && value >= 0);
  if (nested.length === 0) return undefined;
  return Number((nested.reduce((sum, value) => sum + value, 0) / nested.length).toFixed(3));
}

function recordFromUnknown(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function numberFromUnknown(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function boundedConfidence(value: unknown) {
  const number = numberFromUnknown(value);
  if (number === undefined || number < 0) return undefined;
  return Math.min(1, number);
}

function normalizedBBox(value: unknown): OCRLayoutRegion["bbox"] | undefined {
  if (Array.isArray(value) && value.length >= 4) {
    const [x, y, width, height] = value.map(numberFromUnknown);
    if ([x, y, width, height].every((item) => item !== undefined)) {
      return { x: x!, y: y!, width: width!, height: height! };
    }
  }

  const record = recordFromUnknown(value);
  if (!record) return undefined;
  const x = numberFromUnknown(record.x ?? record.left);
  const y = numberFromUnknown(record.y ?? record.top);
  const width = numberFromUnknown(record.width ?? record.w);
  const height = numberFromUnknown(record.height ?? record.h);
  if ([x, y, width, height].every((item) => item !== undefined)) {
    return { x: x!, y: y!, width: width!, height: height! };
  }

  const x1 = numberFromUnknown(record.x1);
  const y1 = numberFromUnknown(record.y1);
  const x2 = numberFromUnknown(record.x2);
  const y2 = numberFromUnknown(record.y2);
  if ([x1, y1, x2, y2].every((item) => item !== undefined) && x2! >= x1! && y2! >= y1!) {
    return { x: x1!, y: y1!, width: x2! - x1!, height: y2! - y1! };
  }

  return undefined;
}

function normalizedLayoutRegion(value: unknown, fallbackPage?: number): OCRLayoutRegion | null {
  const record = recordFromUnknown(value);
  if (!record) return null;
  const text = typeof record.text === "string"
    ? record.text.trim()
    : typeof record.content === "string"
      ? record.content.trim()
      : "";
  const label = typeof record.label === "string"
    ? record.label.trim()
    : typeof record.type === "string"
      ? record.type.trim()
      : "";
  const page = numberFromUnknown(record.page ?? record.pageNumber) ?? fallbackPage;
  const bbox = normalizedBBox(record.bbox ?? record.boundingBox ?? record.box);
  const confidence = boundedConfidence(record.confidence);
  if (!text && !label && !bbox) return null;
  return {
    ...(page !== undefined ? { page } : {}),
    ...(label ? { label } : {}),
    ...(text ? { text } : {}),
    ...(confidence !== undefined ? { confidence } : {}),
    ...(bbox ? { bbox } : {})
  };
}

function collectLayoutCandidates(value: unknown, fallbackPage?: number): OCRLayoutRegion[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectLayoutCandidates(item, fallbackPage));
  }
  const region = normalizedLayoutRegion(value, fallbackPage);
  return region ? [region] : [];
}

function normalizedLayoutFromPayload(payload: HTTPOCRResponse | null): OCRLayoutRegion[] {
  if (!payload) return [];
  const direct = [
    ...collectLayoutCandidates(payload.layout),
    ...collectLayoutCandidates(payload.regions),
    ...collectLayoutCandidates(payload.blocks)
  ];
  const nested = [...(payload.pages ?? []), ...(payload.results ?? [])].flatMap((item, index) => {
    const page = numberFromUnknown((item as { page?: unknown; pageNumber?: unknown }).page ?? (item as { pageNumber?: unknown }).pageNumber) ?? index + 1;
    return [
      ...collectLayoutCandidates(item.layout, page),
      ...collectLayoutCandidates(item.regions, page),
      ...collectLayoutCandidates(item.blocks, page)
    ];
  });

  const seen = new Set<string>();
  return [...direct, ...nested]
    .filter((region) => {
      const key = JSON.stringify(region);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 24);
}

class DisabledOCRProvider implements OCRProvider {
  readonly name = "disabled";

  async extractText(): Promise<OCRProviderResult> {
    return { text: "" };
  }
}

class HTTPOCRProvider implements OCRProvider {
  readonly name: string;
  private readonly endpoint: string;
  private readonly apiKey?: string;
  private readonly model: string;

  constructor(input: { endpoint: string; apiKey?: string; model: string }) {
    this.endpoint = input.endpoint;
    this.apiKey = input.apiKey?.trim() || undefined;
    this.model = input.model;
    this.name = `http-ocr:${input.model}`;
  }

  async extractText(input: {
    fileName: string;
    mimeType: string;
    language?: string;
    images: OCRImageInput[];
  }): Promise<OCRProviderResult> {
    if (input.images.length === 0) return { text: "", model: this.model };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ocrTimeoutMs());
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {})
        },
        body: JSON.stringify({
          model: this.model,
          language: input.language ?? (envValue("LEARNBUDDY_OCR_LANGUAGE") || "de"),
          fileName: input.fileName,
          mimeType: input.mimeType,
          images: input.images.slice(0, 12).map((image) => ({
            name: image.name,
            mimeType: image.mimeType,
            contentBase64: image.bytes.toString("base64"),
            ...(image.page !== undefined ? { page: image.page } : {}),
            ...(image.placement ? { placement: image.placement } : {})
          }))
        }),
        signal: controller.signal
      });
      const payload = await response.json().catch(() => null) as HTTPOCRResponse | null;
      if (!response.ok) {
        const message = typeof payload?.error?.message === "string" ? payload.error.message : `HTTP ${response.status}`;
        throw new Error(`OCR provider request failed: ${message}`);
      }

      return {
        text: normalizedTextFromPayload(payload),
        confidence: normalizedConfidence(payload),
        model: typeof payload?.model === "string" ? payload.model : this.model,
        layout: normalizedLayoutFromPayload(payload)
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("OCR provider request timed out.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

class OpenAICompatibleVisionOCRProvider implements OCRProvider {
  readonly name: string;
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(input: { endpoint: string; apiKey: string; model: string }) {
    this.endpoint = input.endpoint;
    this.apiKey = input.apiKey.trim();
    this.model = input.model;
    this.name = `openai-compatible-vision:${input.model}`;
  }

  async extractText(input: {
    fileName: string;
    mimeType: string;
    language?: string;
    images: OCRImageInput[];
  }): Promise<OCRProviderResult> {
    if (input.images.length === 0) return { text: "", model: this.model };

    const language = input.language ?? (envValue("LEARNBUDDY_OCR_LANGUAGE") || "de");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ocrTimeoutMs());
    const imageContent = input.images.slice(0, 8).map((image) => ({
      type: "image_url",
      image_url: {
        url: `data:${image.mimeType};base64,${image.bytes.toString("base64")}`,
        detail: "auto"
      }
    }));

    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0,
          messages: [
            {
              role: "system",
              content: `Extrahiere sichtbaren Text aus Vorlesungsfolien. Antworte nur mit dem erkannten Text in ${language}.`
            },
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Datei: ${input.fileName}. Extrahiere den gesamten fachlich relevanten Text, Formeln und Beschriftungen aus den Bildern.`
                },
                ...imageContent
              ]
            }
          ]
        }),
        signal: controller.signal
      });
      const payload = await response.json().catch(() => null) as OpenAICompatibleVisionResponse | null;
      if (!response.ok) {
        const message = typeof payload?.error?.message === "string" ? payload.error.message : `HTTP ${response.status}`;
        throw new Error(`OCR vision provider request failed: ${message}`);
      }

      return {
        text: normalizedOpenAICompatibleVisionText(payload),
        confidence: 0.75,
        model: this.model
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("OCR vision provider request timed out.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function normalizedOpenAICompatibleVisionText(payload: OpenAICompatibleVisionResponse | null) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      const record = recordFromUnknown(item);
      return typeof record?.text === "string" ? record.text : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

export function getOCRProvider(): OCRProvider {
  const selected = envValue("LEARNBUDDY_OCR_PROVIDER").toLowerCase();
  if (selected === "openai-compatible" || selected === "openai-vision" || selected === "vision-chat") {
    const endpoint = normalizeOpenAICompatibleVisionBaseUrl(envValue("LEARNBUDDY_OCR_BASE_URL"));
    if (!endpoint) {
      throw new Error("LEARNBUDDY_OCR_BASE_URL is required for LEARNBUDDY_OCR_PROVIDER=openai-compatible.");
    }
    const apiKey = envValue("LEARNBUDDY_OCR_API_KEY");
    if (!apiKey) {
      throw new Error("LEARNBUDDY_OCR_API_KEY is required for LEARNBUDDY_OCR_PROVIDER=openai-compatible.");
    }

    return new OpenAICompatibleVisionOCRProvider({
      endpoint,
      apiKey,
      model: envValue("LEARNBUDDY_OCR_MODEL") || "gpt-4o-mini"
    });
  }

  if (selected === "http" || selected === "external" || selected === "vision" || selected === "ocr") {
    const endpoint = normalizeOCRBaseUrl(envValue("LEARNBUDDY_OCR_BASE_URL"));
    if (!endpoint) {
      throw new Error("LEARNBUDDY_OCR_BASE_URL is required for LEARNBUDDY_OCR_PROVIDER=http.");
    }

    return new HTTPOCRProvider({
      endpoint,
      apiKey: envValue("LEARNBUDDY_OCR_API_KEY"),
      model: envValue("LEARNBUDDY_OCR_MODEL") || "learnbuddy-ocr"
    });
  }

  return new DisabledOCRProvider();
}
