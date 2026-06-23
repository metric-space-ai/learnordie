export type RequestSizeCheck =
  | { ok: true }
  | { ok: false; status: 413; sizeBytes: number; maxBytes: number };

export function checkContentLength(request: Request, maxBytes: number): RequestSizeCheck {
  const contentLength = request.headers.get("content-length");
  if (!contentLength) return { ok: true };

  const sizeBytes = Number(contentLength);
  if (!Number.isFinite(sizeBytes) || sizeBytes < 0) return { ok: true };
  if (sizeBytes <= maxBytes) return { ok: true };

  return {
    ok: false,
    status: 413,
    sizeBytes: Math.floor(sizeBytes),
    maxBytes
  };
}
