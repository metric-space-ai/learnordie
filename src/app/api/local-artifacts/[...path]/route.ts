import { notFound } from "next/navigation";

import { getStorageProvider } from "@/server/providers/storage";

function mediaType(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".zip")) return "application/zip";
  if (lower.endsWith(".html")) return "text/html; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  if (lower.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (lower.endsWith(".svg")) return "image/svg+xml; charset=utf-8";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".bmp")) return "image/bmp";
  if (lower.endsWith(".tif") || lower.endsWith(".tiff")) return "image/tiff";
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
  const mode = /\.(?:svg|png|jpe?g|webp|gif|bmp|tiff?|mp3|m4a|aac|ogg|oga|webm|wav)$/i.test(fileName)
    ? "inline"
    : "attachment";
  return `${mode}; filename="${safeName}"`;
}

export async function GET(_request: Request, context: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await context.params;
  const artifactPath = path.join("/");
  if (!artifactPath) notFound();

  try {
    const bytes = await getStorageProvider("local").readBytes(`local-artifact://${artifactPath}`);
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
