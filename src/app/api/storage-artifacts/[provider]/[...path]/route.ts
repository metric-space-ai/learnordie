import { notFound } from "next/navigation";

import { getStorageProvider } from "@/server/providers/storage";

function mediaType(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".zip")) return "application/zip";
  if (lower.endsWith(".html")) return "text/html; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  if (lower.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".aac")) return "audio/aac";
  if (lower.endsWith(".ogg") || lower.endsWith(".oga")) return "audio/ogg";
  if (lower.endsWith(".webm")) return "audio/webm";
  if (lower.endsWith(".wav")) return "audio/wav";
  return "application/octet-stream";
}

function disposition(fileName: string) {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]+/g, "-") || "learnbuddy-artifact";
  return `attachment; filename="${safeName}"`;
}

export async function GET(
  _request: Request,
  context: { params: Promise<unknown> }
) {
  const { provider, path = [] } = (await context.params) as { provider: string; path?: string[] };
  if (provider !== "http" && provider !== "vercel-blob") notFound();

  const artifactPath = path.join("/");
  if (!artifactPath) notFound();

  try {
    const bytes = await getStorageProvider(provider).readBytes(`/api/storage-artifacts/${provider}/${artifactPath}`);
    const fileName = path[path.length - 1] ?? "learnbuddy-artifact";
    const body = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(body).set(bytes);
    return new Response(body, {
      headers: {
        "content-type": mediaType(fileName),
        "content-disposition": disposition(fileName)
      }
    });
  } catch {
    notFound();
  }
}
