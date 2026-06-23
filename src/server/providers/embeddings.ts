import crypto from "node:crypto";
import { assertDeploymentFetchEndpoint } from "@/server/providers/endpoint-policy";

export const EMBEDDING_DIMENSIONS = 1536;

export interface EmbeddingProvider {
  name: string;
  dimensions: number;
  embedText(text: string): Promise<number[]>;
}

const STOPWORDS = new Set([
  "aber",
  "also",
  "auf",
  "aus",
  "bei",
  "das",
  "den",
  "der",
  "die",
  "ein",
  "eine",
  "einem",
  "einen",
  "einer",
  "fuer",
  "für",
  "ich",
  "ist",
  "mit",
  "mir",
  "und",
  "was",
  "wie",
  "zur"
]);

function normalizedTerms(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .split(/[^a-z0-9]+/i)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && !STOPWORDS.has(term));
}

function addFeature(vector: number[], feature: string, weight: number) {
  const digest = crypto.createHash("sha256").update(feature).digest();
  const index = digest.readUInt32BE(0) % vector.length;
  const sign = digest[4] % 2 === 0 ? 1 : -1;
  vector[index] += sign * weight;
}

function l2Normalize(vector: number[]) {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) return vector;
  return vector.map((value) => Number((value / norm).toFixed(6)));
}

class DeterministicEmbeddingProvider implements EmbeddingProvider {
  name = "learnbuddy-local-hash-v1";
  dimensions = EMBEDDING_DIMENSIONS;

  async embedText(text: string) {
    const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
    const terms = normalizedTerms(text);

    for (const term of terms) {
      addFeature(vector, `term:${term}`, 1);
      for (let index = 0; index <= term.length - 4; index += 1) {
        addFeature(vector, `gram:${term.slice(index, index + 4)}`, 0.2);
      }
    }

    return l2Normalize(vector);
  }
}

type OpenAICompatibleEmbeddingResponse = {
  data?: Array<{
    embedding?: unknown;
  }>;
  error?: {
    message?: unknown;
  };
};

function normalizeEmbeddingBaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  const endpoint = trimmed.endsWith("/embeddings") ? trimmed : `${trimmed}/v1/embeddings`;
  assertDeploymentFetchEndpoint(endpoint, "LEARNBUDDY_EMBEDDING_BASE_URL");
  return endpoint;
}

function embeddingTimeoutMs() {
  const configured = Number(process.env.LEARNBUDDY_EMBEDDING_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? Math.min(60_000, Math.round(configured)) : 15_000;
}

function normalizeEmbeddingVector(value: unknown, expectedDimensions: number) {
  if (!Array.isArray(value)) {
    throw new Error("Embedding provider returned no embedding vector.");
  }

  const vector = value.map((item) => Number(item));
  if (vector.length !== expectedDimensions) {
    throw new Error(`Embedding provider returned ${vector.length} dimensions, expected ${expectedDimensions}.`);
  }
  if (vector.some((item) => !Number.isFinite(item))) {
    throw new Error("Embedding provider returned non-numeric vector values.");
  }

  return vector;
}

class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly dimensions = EMBEDDING_DIMENSIONS;
  readonly name: string;
  private readonly endpoint: string;
  private readonly apiKey?: string;
  private readonly model: string;

  constructor(input: { endpoint: string; apiKey?: string; model: string }) {
    this.endpoint = input.endpoint;
    this.apiKey = input.apiKey?.trim() || undefined;
    this.model = input.model;
    this.name = `openai-compatible:${input.model}`;
  }

  async embedText(text: string) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), embeddingTimeoutMs());
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {})
        },
        body: JSON.stringify({
          model: this.model,
          input: text,
          encoding_format: "float"
        }),
        signal: controller.signal
      });
      const payload = await response.json().catch(() => null) as OpenAICompatibleEmbeddingResponse | null;
      if (!response.ok) {
        const message = typeof payload?.error?.message === "string" ? payload.error.message : `HTTP ${response.status}`;
        throw new Error(`Embedding provider request failed: ${message}`);
      }

      return normalizeEmbeddingVector(payload?.data?.[0]?.embedding, this.dimensions);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Embedding provider request timed out.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function getEmbeddingProvider(): EmbeddingProvider {
  const selected = process.env.LEARNBUDDY_EMBEDDING_PROVIDER?.trim().toLowerCase();
  if (selected === "openai-compatible" || selected === "http") {
    const endpoint = normalizeEmbeddingBaseUrl(process.env.LEARNBUDDY_EMBEDDING_BASE_URL ?? "");
    if (!endpoint) {
      throw new Error("LEARNBUDDY_EMBEDDING_BASE_URL is required for LEARNBUDDY_EMBEDDING_PROVIDER=openai-compatible.");
    }

    return new OpenAICompatibleEmbeddingProvider({
      endpoint,
      apiKey: process.env.LEARNBUDDY_EMBEDDING_API_KEY,
      model: process.env.LEARNBUDDY_EMBEDDING_MODEL?.trim() || "learnbuddy-external-embedding"
    });
  }

  return new DeterministicEmbeddingProvider();
}
