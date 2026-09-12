import { readFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { gzipSync } from "node:zlib";

export type StandaloneCanvasRuntime = {
  source: string;
  sha256: string;
  vendorSha256: string;
  fontFiles: number;
  licenses: string;
  uncompressedBytes: number;
};

let cached: Promise<StandaloneCanvasRuntime> | undefined;
const digest = (bytes: string | Buffer) => crypto.createHash("sha256").update(bytes).digest("hex");

/**
 * A single inline ESM closure works when the downloaded HTML is opened as file://.
 * No import from disk (file-origin CORS), CDN, eval, build, or browser is needed.
 * Only the pinned, checked-in payload listed in PROVENANCE.json is read.
 */
export function buildStandaloneCanvasRuntime(): Promise<StandaloneCanvasRuntime> {
  if (!cached) cached = build().catch((error: unknown) => { cached = undefined; throw error; });
  return cached;
}

/** Normal HTTP content negotiation; downloaded/decoded bytes retain their SHA. */
export function encodeStandaloneDownload(body: string | Buffer, acceptEncoding: string | null) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body, "utf8");
  const gzipAccepted = (acceptEncoding ?? "").split(",").some((part) => {
    const [name, ...parameters] = part.trim().toLowerCase().split(";");
    if (name.trim() !== "gzip") return false;
    const quality = parameters.map((value) => value.trim()).find((value) => value.startsWith("q="));
    return quality === undefined || Number(quality.slice(2)) > 0;
  });
  const encoded = gzipAccepted ? gzipSync(bytes, { level: 6 }) : bytes;
  return { body: Buffer.from(encoded), encoding: gzipAccepted ? "gzip" : undefined, tooLarge: encoded.byteLength > 4 * 1024 * 1024 };
}

async function build(): Promise<StandaloneCanvasRuntime> {
  const directory = path.join(process.cwd(), "public/vendor/excalidraw");
  const provenance = JSON.parse(await readFile(path.join(directory, "PROVENANCE.json"), "utf8")) as {
    package?: string; forkPayload?: Record<string, string>;
  };
  if (provenance.package !== "@excalidraw/excalidraw@0.18.0" || !provenance.forkPayload) throw new Error("Offline native runtime provenance is missing or incompatible.");
  const payload = provenance.forkPayload;
  const verified = async (name: string) => {
    if (!/^[A-Za-z0-9_./-]+$/.test(name) || name.split("/").includes("..") || name.startsWith("/")) throw new Error("Invalid offline runtime payload path.");
    const bytes = await readFile(path.join(directory, name));
    if (!payload[name] || digest(bytes) !== payload[name]) throw new Error(`Offline runtime integrity mismatch: ${name}`);
    return bytes;
  };
  const original = await verified("excalidraw.mjs");
  if (original.length > 12 * 1024 * 1024) throw new Error("Offline runtime exceeds its size budget.");
  let source = original.toString("utf8");
  // The supplied closure is self-contained. Refuse upgrades that introduce
  // imports instead of emitting an ostensibly offline but broken document.
  if (/(?:^|[;}])\s*import(?:\s|["'{*(])|\bimport\s*\(|\bfrom["'](?:[./]|https?:)/.test(source)) throw new Error("Offline runtime must be a closed browser module.");
  const exportTable = source.match(/export\{([^{}]+)\};?\s*$/)?.[1];
  const svgExport = exportTable?.split(",").map((item) => item.trim()).find((item) => item.endsWith(" as exportToSvg"))?.split(" as ")[0];
  if (!svgExport || !/^[\w$]+$/.test(svgExport)) throw new Error("Native SVG export is unavailable in this runtime.");
  const fontNames = Object.keys(payload).filter((name) => /^fonts\/[A-Za-z]+\/[A-Za-z0-9_.-]+\.woff2$/.test(name));
  if (fontNames.length < 20 || fontNames.length > 50) throw new Error("Offline font inventory is incomplete or unexpected.");
  const fontUrls = new Map<string, string>();
  // Sequential bounded reads avoid spawning a worker per font or slide.
  for (const name of fontNames) {
    const bytes = await verified(name);
    if (bytes.length > 256 * 1024) throw new Error("Offline font exceeds its size budget.");
    fontUrls.set(`./${name}`, `data:font/woff2;base64,${bytes.toString("base64")}`);
  }
  source = source.replace(/"(\.\/fonts\/[^"\r\n]+\.woff2)"/g, (_literal, name: string) =>
    JSON.stringify(fontUrls.get(name) ?? "data:font/woff2;base64,"));
  // Inline modules can have about:blank as import.meta.url in preview/tests.
  // Data font URLs resolve against this inert absolute base, never fetch it.
  const localBase = 'new URL("./",import.meta.url).href';
  if (!source.includes(localBase)) throw new Error("Offline font fallback contract changed.");
  source = source.replace(localBase, '"https://learnordie.invalid/offline-assets/"');
  source += `\nwindow.__learnordieOfflineSvg = ${svgExport};\nwindow.dispatchEvent(new Event("learnordie-offline-native-ready"));\n`;
  const uncompressedBytes = Buffer.byteLength(source);
  // Base64-gzip keeps this checked-in closure below serverless response budgets.
  // Decompression -> blob module import remains native ESM, never eval/code text.
  const compressed = gzipSync(source, { level: 6 }).toString("base64");
  source = `try {
    if (!globalThis.DecompressionStream) throw new Error("DecompressionStream unavailable");
    const bytes = Uint8Array.from(atob(${JSON.stringify(compressed)}), character => character.charCodeAt(0));
    const body = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
    const moduleUrl = URL.createObjectURL(new Blob([body], { type: "text/javascript" }));
    try { await import(moduleUrl); } finally { URL.revokeObjectURL(moduleUrl); }
  } catch {
    window.dispatchEvent(new Event("learnordie-offline-native-failed"));
  }`;
  const licenseNames = ["LICENSE", "NOTICE.md", ...Object.keys(payload).filter((name) => name.startsWith("licenses/")).sort()];
  const notices: string[] = [];
  for (const name of licenseNames) notices.push(`${name}\n${(await verified(name)).toString("utf8")}`);
  return { source, sha256: digest(source), vendorSha256: digest(original), fontFiles: fontNames.length, licenses: notices.join("\n\n"), uncompressedBytes };
}
