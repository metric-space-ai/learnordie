import { configuredPublicAppUrl } from "@/server/runtime-config";
import { assertDeploymentFetchEndpoint } from "@/server/providers/endpoint-policy";

export type JobKind = "standalone_archive" | "material_processing";

export type JobRunInput = {
  jobId: string;
  kind: JobKind;
};

export type JobRunResult<T> = {
  provider: string;
  providerJobId: string;
  result: T;
};

export interface JobProvider {
  readonly name: string;
  run<T>(input: JobRunInput, handler: () => Promise<T>): Promise<JobRunResult<T>>;
}

class InlineJobProvider implements JobProvider {
  readonly name = "inline";

  async run<T>(input: JobRunInput, handler: () => Promise<T>): Promise<JobRunResult<T>> {
    return {
      provider: this.name,
      providerJobId: `inline:${input.kind}:${input.jobId}`,
      result: await handler()
    };
  }
}

type HttpJobBrokerResponse = {
  providerJobId?: unknown;
};

function jobProviderTimeoutMs() {
  const configured = Number(process.env.LEARNBUDDY_JOB_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? Math.min(60_000, Math.round(configured)) : 15_000;
}

function normalizeJobEndpoint(value: string) {
  const endpoint = value.trim();
  if (!endpoint) return "";
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("LEARNBUDDY_JOB_ENDPOINT must be an absolute HTTP(S) URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("LEARNBUDDY_JOB_ENDPOINT must be an absolute HTTP(S) URL.");
  }
  const endpointUrl = url.toString();
  assertDeploymentFetchEndpoint(endpointUrl, "LEARNBUDDY_JOB_ENDPOINT");
  return endpointUrl;
}

class HttpJobProvider implements JobProvider {
  readonly name = "http";
  private readonly endpoint: string;
  private readonly apiKey?: string;

  constructor(input: { endpoint: string; apiKey?: string }) {
    this.endpoint = input.endpoint;
    this.apiKey = input.apiKey?.trim() || undefined;
  }

  private async registerJob(input: JobRunInput) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), jobProviderTimeoutMs());
    try {
      const response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {})
        },
        body: JSON.stringify({
          jobId: input.jobId,
          kind: input.kind,
          executionMode: "brokered-inline",
          appUrl: configuredPublicAppUrl() || null,
          requestedAt: new Date().toISOString()
        }),
        signal: controller.signal
      });
      const payload = await response.json().catch(() => null) as HttpJobBrokerResponse | null;
      if (!response.ok) {
        throw new Error(`Job provider request failed: HTTP ${response.status}`);
      }
      return typeof payload?.providerJobId === "string" && payload.providerJobId.trim()
        ? payload.providerJobId.trim()
        : `http:${input.kind}:${input.jobId}`;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error("Job provider request timed out.");
      }
      if (error instanceof TypeError || (error instanceof Error && error.message.includes("fetch failed"))) {
        throw new Error("Job provider request failed.");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  async run<T>(input: JobRunInput, handler: () => Promise<T>): Promise<JobRunResult<T>> {
    const providerJobId = await this.registerJob(input);
    return {
      provider: this.name,
      providerJobId,
      result: await handler()
    };
  }
}

export function getJobProvider(): JobProvider {
  const selected = process.env.LEARNBUDDY_JOB_PROVIDER?.trim().toLowerCase();
  if (!selected || selected === "inline" || selected === "local") {
    return new InlineJobProvider();
  }

  if (selected === "http" || selected === "webhook" || selected === "external") {
    const endpoint = normalizeJobEndpoint(process.env.LEARNBUDDY_JOB_ENDPOINT ?? "");
    if (!endpoint) {
      throw new Error("LEARNBUDDY_JOB_ENDPOINT is required for LEARNBUDDY_JOB_PROVIDER=http.");
    }

    return new HttpJobProvider({
      endpoint,
      apiKey: process.env.LEARNBUDDY_JOB_API_KEY
    });
  }

  throw new Error(`Unsupported LEARNBUDDY_JOB_PROVIDER: ${selected}`);
}
