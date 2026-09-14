import type { SlideAssetRef } from "@learnordie/slide-engine/schema";
import { isSafeCanvasImage, type CanvasScene } from "@learnordie/slide-engine/excalidraw/canvas-schema";

/** Browser-only migration of assets already referenced by the authorized slide.
 * No server-side URL fetching/proxy or new destination is introduced. */
export async function hydrateCanvasAssets(scene: CanvasScene, assets: SlideAssetRef[], signal: AbortSignal): Promise<{ scene: CanvasScene; failed: string[] }> {
  const pending = scene.elements.filter((element) => element.customData?.assetPlaceholder && !element.isDeleted);
  if (!pending.length) return { scene, failed: [] };
  const files = { ...scene.files };
  const replacements = new Map<string, string>();
  const failed: string[] = [];
  for (const element of pending) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const asset = assets.find((item) => item.id === element.customData?.sourceAssetId);
    try {
      if (!asset?.url) throw new Error("No accessible image URL");
      const url = new URL(asset.url, window.location.href);
      if (url.origin !== window.location.origin && url.protocol !== "https:") throw new Error("Unsupported image origin");
      const response = await fetch(url.href, { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]), credentials: "same-origin", referrerPolicy: "no-referrer" });
      if (!response.ok) throw new Error("Image unavailable");
      if (Number(response.headers.get("content-length")) > 4 * 1024 * 1024) throw new Error("Image exceeds budget");
      const blob = await boundedImageBlob(response);
      if (blob.size > 4 * 1024 * 1024 || !/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(blob.type)) throw new Error("Unsupported image");
      const dataURL = await rasterImage(blob, signal);
      if (!isSafeCanvasImage(dataURL)) throw new Error("Invalid raster image");
      const fileId = `native:${asset.id}`;
      files[fileId] = { id: fileId, dataURL, mimeType: "image/png", created: 0 };
      replacements.set(element.id, fileId);
    } catch (error) {
      if (signal.aborted) throw error;
      failed.push(asset?.title ?? element.customData?.sourceAssetId ?? "Bild");
    }
  }
  const hydratedBlocks = new Set(pending.filter((element) => replacements.has(element.id)).map((element) => element.customData?.sourceBlockId));
  const elements = scene.elements.map((element) => {
    const fileId = replacements.get(element.id);
    if (fileId) return { ...element, type: "image" as const, fileId, status: "saved", scale: [1, 1], crop: null,
      customData: { ...element.customData, assetPlaceholder: false } };
    if (element.type === "text" && hydratedBlocks.has(element.customData?.sourceBlockId) && element.id.endsWith(":caption")) {
      return { ...element, text: element.text?.replace(/^Bildimport ausstehend\n?/, ""), originalText: element.originalText?.replace(/^Bildimport ausstehend\n?/, "") };
    }
    return element;
  });
  return { scene: { ...scene, elements, files }, failed };
}

async function boundedImageBlob(response: Response): Promise<Blob> {
  if (!response.body) throw new Error("Empty image");
  const reader = response.body.getReader();
  const chunks: ArrayBuffer[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > 4 * 1024 * 1024) { await reader.cancel(); throw new Error("Image exceeds budget"); }
      chunks.push(new Uint8Array(next.value).buffer);
    }
  } finally { reader.releaseLock(); }
  return new Blob(chunks, { type: (response.headers.get("content-type") ?? "").split(";")[0].trim() });
}

async function rasterImage(blob: Blob, signal: AbortSignal): Promise<string> {
  const source = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.src = source;
    const decodeSignal = AbortSignal.any([signal, AbortSignal.timeout(5000)]);
    let rejectDecode: (reason: Error) => void = () => undefined;
    const onAbort = () => rejectDecode(new DOMException("Aborted", "AbortError"));
    const aborted = new Promise<never>((_, reject) => { rejectDecode = reject; });
    decodeSignal.addEventListener("abort", onAbort, { once: true });
    try {
      if (decodeSignal.aborted) throw new DOMException("Aborted", "AbortError");
      await Promise.race([image.decode(), aborted]);
    } finally { decodeSignal.removeEventListener("abort", onAbort); }
    if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 24_000_000) throw new Error("Image dimensions exceed budget");
    const scale = Math.min(1, 1600 / image.naturalWidth, 1200 / image.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally { URL.revokeObjectURL(source); }
}
