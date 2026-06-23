import fs from "node:fs/promises";
import path from "node:path";
import { assertDeploymentFetchEndpoint } from "@/server/providers/endpoint-policy";

export interface StorageProvider {
  readonly name: string;
  putText(path: string, content: string, contentType: string): Promise<{ url: string }>;
  readText(url: string): Promise<string>;
  putBytes(path: string, content: Buffer, contentType: string): Promise<{ url: string }>;
  readBytes(url: string): Promise<Buffer>;
}

const ARTIFACT_ROOT = path.join(process.cwd(), ".data", "artifacts");
const STORAGE_ARTIFACT_PREFIX = "/api/storage-artifacts";

type StorageProviderName = "local" | "http" | "vercel-blob";

function normalizeArtifactPath(input: string) {
  const decoded = decodeURIComponent(input);
  if (
    decoded.includes("\0") ||
    decoded.includes("\\") ||
    decoded.startsWith("/") ||
    /^[A-Za-z]:\//.test(decoded)
  ) {
    throw new Error("Invalid storage artifact path.");
  }

  const normalized = path.posix.normalize(decoded).replace(/^\/+/, "");
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.split("/").includes("..")
  ) {
    throw new Error("Invalid storage artifact path.");
  }

  return normalized || "artifact.txt";
}

function storageRouteUrl(provider: StorageProviderName, artifactPath: string) {
  return `${STORAGE_ARTIFACT_PREFIX}/${provider}/${artifactPath.split("/").map(encodeURIComponent).join("/")}`;
}

function artifactPathFromUrl(url: string) {
  if (url.startsWith("/api/local-artifacts/")) {
    return normalizeArtifactPath(url.slice("/api/local-artifacts/".length));
  }

  if (url.startsWith("local-artifact://")) {
    return normalizeArtifactPath(url.slice("local-artifact://".length));
  }

  return normalizeArtifactPath(url);
}

function providerPathFromUrl(provider: StorageProviderName, url: string) {
  const routePrefix = `${STORAGE_ARTIFACT_PREFIX}/${provider}/`;
  if (url.startsWith(routePrefix)) {
    return normalizeArtifactPath(url.slice(routePrefix.length));
  }

  if (url.startsWith(`${provider}://`)) {
    return normalizeArtifactPath(url.slice(`${provider}://`.length));
  }

  return normalizeArtifactPath(url);
}

function rejectAbsoluteStorageReadUrl(url: string) {
  if (/^https?:\/\//i.test(url.trim())) {
    throw new Error("Absolute storage object URLs are not supported.");
  }
}

function storageTimeoutMs() {
  const configured = Number(process.env.LEARNBUDDY_STORAGE_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? Math.min(60_000, Math.round(configured)) : 15_000;
}

function normalizeStorageEndpoint(value: string) {
  const endpoint = value.trim();
  if (!endpoint) return "";
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("LEARNBUDDY_STORAGE_ENDPOINT must be an absolute HTTP(S) URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("LEARNBUDDY_STORAGE_ENDPOINT must be an absolute HTTP(S) URL.");
  }
  const endpointUrl = url.toString().replace(/\/+$/, "");
  assertDeploymentFetchEndpoint(endpointUrl, "LEARNBUDDY_STORAGE_ENDPOINT");
  return endpointUrl;
}

function storageObjectUrl(endpoint: string, artifactPath: string) {
  const encodedPath = artifactPath.split("/").map(encodeURIComponent).join("/");
  return `${endpoint}/objects/${encodedPath}`;
}

function bufferBody(content: Buffer) {
  const body = new ArrayBuffer(content.byteLength);
  new Uint8Array(body).set(content);
  return body;
}

async function fetchWithTimeout(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), storageTimeoutMs());
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Storage provider request timed out.");
    }
    if (error instanceof TypeError || (error instanceof Error && error.message.includes("fetch failed"))) {
      throw new Error("Storage provider request failed.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

class LocalStorageProvider implements StorageProvider {
  readonly name = "local";

  async putText(pathName: string, content: string, contentType: string) {
    void contentType;
    return this.putBytes(pathName, Buffer.from(content, "utf8"));
  }

  async putBytes(pathName: string, content: Buffer) {
    const artifactPath = normalizeArtifactPath(pathName);
    const absolutePath = path.join(ARTIFACT_ROOT, artifactPath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content);
    return { url: `/api/local-artifacts/${artifactPath.split("/").map(encodeURIComponent).join("/")}` };
  }

  async readText(url: string) {
    return (await this.readBytes(url)).toString("utf8");
  }

  async readBytes(url: string) {
    rejectAbsoluteStorageReadUrl(url);
    const artifactPath = artifactPathFromUrl(url);
    return fs.readFile(path.join(ARTIFACT_ROOT, artifactPath));
  }
}

class HttpStorageProvider implements StorageProvider {
  readonly name = "http";
  private readonly endpoint: string;
  private readonly apiKey?: string;

  constructor(input: { endpoint: string; apiKey?: string }) {
    this.endpoint = input.endpoint;
    this.apiKey = input.apiKey?.trim() || undefined;
  }

  async putText(pathName: string, content: string, contentType: string) {
    return this.putBytes(pathName, Buffer.from(content, "utf8"), contentType);
  }

  async putBytes(pathName: string, content: Buffer, contentType: string) {
    const artifactPath = normalizeArtifactPath(pathName);
    const response = await fetchWithTimeout(storageObjectUrl(this.endpoint, artifactPath), {
      method: "PUT",
      headers: {
        "content-type": contentType,
        "content-length": String(content.byteLength),
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {})
      },
      body: bufferBody(content)
    });

    if (!response.ok) {
      throw new Error(`Storage provider request failed: HTTP ${response.status}`);
    }

    return { url: storageRouteUrl(this.name, artifactPath) };
  }

  async readText(url: string) {
    return (await this.readBytes(url)).toString("utf8");
  }

  async readBytes(url: string) {
    rejectAbsoluteStorageReadUrl(url);
    const artifactPath = providerPathFromUrl(this.name, url);
    const response = await fetchWithTimeout(storageObjectUrl(this.endpoint, artifactPath), {
      method: "GET",
      headers: {
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {})
      }
    });

    if (!response.ok) {
      throw new Error(`Storage object could not be read: ${response.status}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }
}

class VercelBlobStorageProvider implements StorageProvider {
  readonly name = "vercel-blob";
  private readonly access: "public" | "private";
  private readonly token?: string;

  constructor(input: { access?: string; token?: string }) {
    this.access = input.access === "public" ? "public" : "private";
    this.token = input.token?.trim() || process.env.BLOB_READ_WRITE_TOKEN?.trim() || undefined;
  }

  async putText(pathName: string, content: string, contentType: string) {
    return this.putBytes(pathName, Buffer.from(content, "utf8"), contentType);
  }

  async putBytes(pathName: string, content: Buffer, contentType: string) {
    const artifactPath = normalizeArtifactPath(pathName);
    try {
      const { put } = await import("@vercel/blob");
      const result = await put(artifactPath, content, {
        access: this.access,
        allowOverwrite: true,
        contentType,
        token: this.token
      });
      return { url: storageRouteUrl(this.name, result.pathname) };
    } catch (error) {
      if (error instanceof Error && error.message.includes("No token")) {
        throw new Error("Storage provider is not configured.");
      }
      throw new Error("Storage provider request failed.");
    }
  }

  async readText(url: string) {
    return (await this.readBytes(url)).toString("utf8");
  }

  async readBytes(url: string) {
    rejectAbsoluteStorageReadUrl(url);
    const artifactPath = providerPathFromUrl(this.name, url);
    try {
      const { get } = await import("@vercel/blob");
      const result = await get(artifactPath, {
        access: this.access,
        token: this.token,
        useCache: false
      });
      if (!result || result.statusCode !== 200) {
        throw new Error("Storage object could not be read.");
      }
      return Buffer.from(await new Response(result.stream).arrayBuffer());
    } catch {
      throw new Error("Storage provider request failed.");
    }
  }
}

export function getStorageProvider(providerName?: string): StorageProvider {
  const selected = (providerName ?? process.env.LEARNBUDDY_STORAGE_PROVIDER ?? "").trim().toLowerCase();

  if (!selected || selected === "local" || selected === "filesystem") {
    return new LocalStorageProvider();
  }

  if (selected === "http" || selected === "object-http" || selected === "external") {
    const endpoint = normalizeStorageEndpoint(process.env.LEARNBUDDY_STORAGE_ENDPOINT ?? "");
    if (!endpoint) {
      throw new Error("LEARNBUDDY_STORAGE_ENDPOINT is required for LEARNBUDDY_STORAGE_PROVIDER=http.");
    }

    return new HttpStorageProvider({
      endpoint,
      apiKey: process.env.LEARNBUDDY_STORAGE_API_KEY
    });
  }

  if (selected === "vercel" || selected === "vercel-blob" || selected === "blob") {
    return new VercelBlobStorageProvider({
      access: process.env.LEARNBUDDY_STORAGE_ACCESS,
      token: process.env.LEARNBUDDY_STORAGE_TOKEN
    });
  }

  throw new Error(`Unsupported LEARNBUDDY_STORAGE_PROVIDER: ${selected}`);
}
